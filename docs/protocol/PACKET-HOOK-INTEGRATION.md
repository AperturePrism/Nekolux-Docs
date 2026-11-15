# packet 层收发监听 · 运行时集成

> 日期：2026-11-15
> 状态：**native 组件完成并经零账号端到端验证；运行时集成暂缓**（见 §〇）
> 目标：MoeHoo 式 packet 收发监听，为诊断与闭源 addon 失效场景提供独立通道

---

## 〇、重要更正（2026-11-15 集成阶段发现）

**运行时不存在 "send_packet 缺口"。** 深入 snowluma fork 桥接层后确认：

- `PipeOp.recvPacket = 6`——闭源 hook 模块**本来就通过 QHP1 recv 管道流式推送全部已解析包**
  （`QqHookPacket {seq, cmd, uin, body}` → `HookSession` → `BridgeManagerSink.onPacket`），
  与 MoeHoo 回调字段一一对应
- OneBot `send_packet` action **早已实现**（`packages/onebot/src/actions/extended.ts:4810`，
  `ctx.bridge.sendRawPacket(cmd, body)` → QHP1 `sendRequest`）；NAS 生产环境的戳一戳撤回
  即走此通道
- "send_packet 缺口"是 **NapCat 生态的问题**（NapCat 自己的 napi2native/packet.json 表缺版本
  导致 segfault），Nekolux 运行时的闭源 addon 走 RTTI 自定位，不依赖那些表

因此本组件的定位修正为：**诊断工具 + 保险**——当未来 QQ 版本上闭源 addon（不可修）失效时，
这套开源的独立捕获通道是现成的降级路径。日常不必接入运行时（闭源管道已覆盖，多一路注入
只增加攻击面与复杂度）。

## 一、架构决策

| 选项 | 结论 |
|---|---|
| 复用闭源 loader（`loadModuleManualAsync`） | ❌ 实测拒绝非白名单模块（`COMPONENT_LOAD_FAILED`）——loader 按导出符号识别模块（`snowluma_linux_hook_*` 6 个符号）；模仿符号会与真 hook 模块冲突 |
| 自研 ptrace 注入器（远程 dlopen） | ✅ **采用**。`PTRACE_ATTACH` → 单步执行 libc 内 `syscall;ret` gadget 完成远程 mmap → 远程调用 `dlopen(path, RTLD_NOW)` → int3 返回桩捕获 → 恢复寄存器 DETACH。glibc 原生完成重定位/TLS/init_array，无需手写 manual-map |
| LD_PRELOAD（部署层） | 备选（需控制 QQ 启动），当前不需要 |

组件（全部原创代码，PolyForm NC）：

| 文件 | 角色 |
|---|---|
| `native/packet-hook/injector.c` | 注入器（~300 行 C，独立二进制） |
| `native/packet-hook/packet-hook.c` | hook 模块（detour + 无锁环形缓冲 + UNIX socket JSON 行协议 + 文件 dump） |

## 二、已验证事实（全部零账号，QQ 全程存活）

1. **注入链路**：QQ 主进程（映射 wrapper.node 者）注入成功，dlopen 返回非空，构造函数执行，worker 线程启动。失败路径（错误 gadget/缺模块）QQ 无伤。
2. **detour**：入口 14 字节 `jmp [rip+0]` + 8 字节绝对地址；跳板 = 原 17 字节前缀 + 跳回 entry+17（前缀均为 push/sub，无 RIP 相对引用，30 秒观察窗内 QQ 稳定收发）。
3. **收发监听**：30 秒 32 次捕获（登录页心跳节奏），文件 dump + UNIX socket 双通道。
4. **socket 协议**：python 客户端收 25 个 JSON 行事件（13 send / 12 recv），`{"kind":"send|recv","t","ns","tid","args":[6 个十六进制],"l1":[各参数一级内存],"l2":[二级字段 hex]}`。

## 三、ABI 初步事实（待 v2 完整解析）

来自 uprobe 寄存器快照 + 进程内 dump（登录页流量）：

| 观测 | 事实 |
|---|---|
| 线程 | MSFNG-*（MSF NextGen 工作线程） |
| a0(rdi) | 会话/引擎对象，恒定；L1 内 +0x48 递增计数器、+0x58 方向字段（send=1/recv=2） |
| a1(rsi) | 调用方栈上结构体；**+0x38 处指针指向命令字符串**（实测 `22 "wtlogin.trans_emp" 00`） |
| recv a3(rcx) | **递增序列号**（0x27c498 起每包 +1）——即 MoeHoo 回调的 seq |
| send a4(r8) | 每次调用新分配 0x1e0 字节请求对象 |
| 收发对称 | uprobe 三次窗口 39:39 / 64:64 / 18:18，进程内 13:12 —— 全部近 1:1 |

## 四、踩过的坑（修法已固化在代码里）

| 坑 | 症状 | 修法 |
|---|---|---|
| **闭源 loader 白名单** | `COMPONENT_LOAD_FAILED`，构造函数不执行 | 弃用闭源 loader，自研注入器 |
| **maps 解析截断** | "未找到 libc" | 上限 512→4096，堆分配 |
| **符号名** | glibc 2.36 无 `__libc_dlopen_mode` 命中 | 优先公开符号 `dlopen`（2.34 起在 libc 本体） |
| **gadget 地址换算** | SINGLESTEP 即杀进程 | 运行时地址 = 映射起点 + (文件命中 − 段文件偏移)；执行前 /proc/pid/mem 校验 `0f 05 c3` |
| **PEEK 未附加** | 校验永远失败（EPERM 当作字节错） | 校验改用 /proc/pid/mem 直读 |
| **远程栈 2KB** | dlopen 内部 SIGSEGV | 1MB 栈；mmap RW + 页内 int3 桩 + 页转 RX（无 RWX 瞬态） |
| **栈对齐** | movaps SIGSEGV（dump 无 hook 模块 = 崩在 dlopen 内） | 入口 rsp%16==8：stack_top 再减 8 |
| **致命信号回注** | 崩溃被放大成进程死亡 | 致命信号不回注，恢复原始寄存器 DETACH（QQ 可存活），打印 rip 所属模块 |
| **GOT 双重解引用缺失** | `jmp *%r11` 跳进自己 .data 段当代码执行——三模式全崩、RIP-RSP 差跨次一致 | `mov x@GOTPCREL(%rip), %r11` 取到的是变量**地址**，须再 `mov (%r11), %r11` |
| **热路径 stdio** | fopen/fprintf 在外部线程调用链里 SIGSEGV | 桩内零 libc：无锁环形缓冲入环 + L1/L2 就地拷贝，worker 离线格式化落盘 |

## 五、复现流程（VPS）

```bash
gcc -O2 -o nekolux-packet-inject injector.c
gcc -shared -fPIC -O1 -o nekolux-packet-hook.so packet-hook.c -lpthread
# conf（可选）：mode=2 sock=/tmp/nekolux-packet.sock dump=/tmp/nekolux-packet-dump.log
./nekolux-packet-inject <映射 wrapper.node 的 pid> ./nekolux-packet-hook.so
# 客户端连 /tmp/nekolux-packet.sock（SOCK_SEQPACKET）逐行收 JSON
```

测试脚本：`tools/reversing/m3-cycle.sh`（注入周期）、`m3-socket-test.sh`（socket 验证）、
`uprobe-abi-r1.sh`/`r2`（ABI 快照）、`m2-loader-probe.sh`（闭源 loader 行为实证）。

## 六、剩余工作（仅在决定接入运行时时需要）

1. **TS 桥**（snowluma fork `packages/bridge`）：`PacketHookService` —— spawn 注入器 → 连 socket → 解析 JSON → 事件分发；dist 打包加 `nekolux-packet-hook.so` + 注入器；注入时机排在主 hook 会话建立之后（ptrace 槽位串行）
2. **ABI 完整解析**：从 l2 提取 cmd 字符串、从 recv a3 取 seq、定位包体与 uin —— 对齐 MoeHoo 回调字段（uin/cmd/seq/hex_data）
3. **send_packet**：已由闭源 addon 通道覆盖（见 §〇）；如需本组件独立发包，再逆向请求对象（0x1e0）构造侧，且必须在登录态验证
4. **清理**：`g_head++` 改原子操作（当前 send/recv 同线程，暂无竞争）；v2 增加卸载恢复（摘除 detour、还原入口）
