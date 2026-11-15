# Linux 签名采集：现状与阻塞

> 日期：2026-11-13
> **⚠️ 本文档已被 `LINUX-HOOK-INVESTIGATION.md` 取代。**
>
> 后续在真实 Linux（VPS）上完成了完整调查，结论是：**QQ 3.2.35 把网络层搬到了主程序的 libuv，
> `wrapper.node` 不再参与网络 I/O，因此 NapCat 的封包 hook 架构在 Linux 3.2.35 上已失效。**
>
> 请直接阅读 [`LINUX-HOOK-INVESTIGATION.md`](LINUX-HOOK-INVESTIGATION.md)。
>
> 本文档保留的是 WSL 阶段的调查过程，其中的「签名采集受阻」判断在当时是合理的，
> 但根本原因不是「语义不明确」，而是**架构变更**。

---

## 一、目标

让 NapCat 的封包 hook 在 Linux 上也能用（当前只支持 Windows 签名）。

---

## 二、已确认的事实

### 2.1 Linux QQ 环境

```
QQ 版本: 3.2.35-54395（2026-10-28 构建）
wrapper.node: 152,431,496 B, ELF64 x64, stripped
.text: VA 0x299E300 .. 0x8E0FE40  (file offset 0x299D300)
导出符号: 885 个（含完整 MSF 命名空间）
```

### 2.2 NapCat 有两套偏移表，语义不同

| 表 | 位置 | 用途 | 值示例（3.2.34 x64） |
|---|---|---|---|
| `napi2native.json` | `napcat-core/external/` | 封包 hook（send/recv 方向） | send `0x6E5AB20` |
| `packet.json` | `napcat-core/external/` | 另一套封包机制 | send `0xCBF25A0` |

**两者都不是函数入口。** 实测验证：

- `napi2native.json` 的 3.2.34 send 值在当前二进制里落在函数中间
  （`0f 85 4a ff ff ff`，是一条 jne 指令）
- `packet.json` 的 3.2.34 值 `0xCBF25A0` **超出文件大小**（152MB = `0x915A6C8`）
- Windows 的 `packet.json` 值（`0x38255F0`）也不是函数入口

### 2.3 Windows 与 Linux 的差异

| | Windows | Linux |
|---|---|---|
| `wrapper.node` 格式 | PE x64 | ELF64 x64 |
| 导出符号数 | **66** | **885** |
| MSF 符号可见 | ❌ | ✅ |
| `napi2native.json` 偏移 | RVA（实测确认） | 疑似 VA 或旧版 file offset |
| 已验证签名 | ✅ send/recv 各唯一 | ❌ |

**Windows 只有 66 个导出，没有 MSF 符号** —— 这解释了为什么 Windows 必须靠签名定位。

---

## 三、尝试过的方法（全部失败）

### 3.1 直接套用旧偏移

```
用 3.2.34 的 0x6E5AB20 在 3.2.35 二进制里：
→ 落在函数中间（jne 指令），不是入口
→ initHook 会 segfault
```

### 3.2 跨版本结构对齐

按 LLQQNT 文档 §10.2 的方法，用旧版本的字节上下文去新版本里搜。
**但前提是「已知旧版本的二进制」** —— 3.2.34 的安装包已经全部 404：

- `qqdl.gtimg.cn` 各版本路径探测 → 全部 404
- AUR `linuxqq` PKGBUILD 只有最新版
- 腾讯官网给的是 2025-06 的失效链接

### 3.3 符号锚点法

Linux 有 885 个导出符号，含 `MSFSDK::sendPacket`（VA `0x670DD20`）。
在它 ±2MB 范围内搜索函数序言：

```
区域内序言候选: 3027
48 字节唯一: 2645
```

**候选太多，无法收敛。** 而且 `sendPacket` 本身通过虚表调用
（`call *0x28(%rax)`），真正的封包发送函数在别处，与它没有直接的静态调用关系。

### 3.4 ELF `.eh_frame` 函数枚举

用 `readelf -wf` 枚举出 **322,547** 个函数边界。但：

- 枚举本身要几分钟
- 对每个函数做唯一性检测（全文件搜索 48 字节）会跑几小时
- 而且即使枚举出来，也不知道**哪个函数**是 hook 目标

### 3.5 分析 `sendPacket` 的反汇编

`sendPacket` 有 6 处虚表调用，全部是运行时解析的。
没有静态调用边能追到真正的封包收发函数。

---

## 四、根本原因

### 4.1 NapCat 的 hook 点不是函数入口

所有历史偏移在当前二进制里都落在**函数内部**。这意味着 `napi2native` 的
hook 目标是函数里的某个特定指令，而不是函数开头。

**从字节层面无法推断「哪个指令是 hook 点」** —— 这需要理解 `napi2native`
的 hook 逻辑（它是闭源二进制）。

### 4.2 SnowLuma 的做法无法借鉴

SnowLuma 在 Linux 上工作，但它的 hook 逻辑**完全封装在原生 `.so` 里**：

```ts
// packages/bridge/src/injector.ts
loadModuleManualAsync(pid: number, dylibPath: string): Promise<ManualMapHandle>;
```

TS 层只传 `pid` 和 `.so` 路径，不传任何偏移。函数定位在 `.so` 内部完成
（backend info 显示 `runtimeResolution: elf64-eh-frame-itanium-rtti`）。

**没有 C++ 源码，无法知道它怎么选的 hook 点。**

### 4.3 两条路都走不通

| 路线 | 需要 | 现状 |
|---|---|---|
| 学 SnowLuma | C++ 源码 | ❌ 无（闭源原生组件） |
| 学 NapCat | 旧版本二进制做对齐 | ❌ 无（下载全失效） |
| 自己逆向 | IDA + 大量时间 | 可行但成本高 |

---

## 五、可行的替代方案

### 5.1 用 GDB 动态定位（推荐，但需要登录账号）

**已实测**：GDB 可以成功 attach 到 Linux QQ 主进程，并在
`MSFSDK::sendPacket`（VA `0x670DD20`）下断点：

```
Breakpoint 1 at 0x670dd20
breakpoint set at 0x670dd20, running 60 seconds...
（60 秒内 0 命中）
```

**阻塞点**：QQ 未登录，`sendPacket` 没有被调用。要触发封包收发必须**扫码登录**。

登录后步骤：

```bash
# 1. 启动 QQ 并扫码登录
cd /opt/qqroot/opt/QQ && ./qq --no-sandbox &

# 2. attach 主进程
gdb -p $(pgrep -f "^./qq --no-sandbox$" | head -1)

# 3. 在 sendPacket 下断点
(gdb) b *0x670DD20
(gdb) commands
> silent
> printf "=== sendPacket hit ===\n"
> bt 12
> continue
> end
(gdb) c

# 4. 用另一个账号给这个账号发一条消息
# 5. 观察调用栈，找到真正的封包收发函数
```

**这是唯一可靠的路径**，但需要两个 QQ 账号（一个登录，一个发消息）。

### 5.2 用 LD_PRELOAD 拦截（更简单）

不 hook QQ 内部函数，而是在 `libc` 层拦截：

```c
// send() / recv() / write() / read() 的 socket 调用
// 但 QQ 用的是内部封包格式，libc 层只能看到加密后的字节
```

**问题**：MSF 层的封包在 libc 之前已经加密/封装，拦截 libc 拿不到明文 cmd。
所以这条路只适合确认「有没有封包流动」，不适合解析。

### 5.3 用 `napi2native` 的 hook 逻辑做黑盒测试

`napi2native.linux.x64.node` 导出 `initHook(send, recv)`。
可以**暴力尝试**：在函数入口列表里逐个试，看哪个不崩溃且能收到封包。

```python
for candidate_va in function_entries:
    result = napi.initHook(candidate_va, candidate_va)
    if result:  # 不崩溃
        # 触发消息，看是否收到封包
```

**风险**：每次崩溃都要重启 QQ。322K 个候选，不可行。

但如果把范围缩小到「MSF 相关函数」（比如 `sendPacket` 前后 100KB 内的函数入口），
候选可能只有几百个，勉强可行。

### 5.4 接受现状：Linux 用 NapCat 主路径

**NapCat 的主路径（NodeIKernel API）不走封包 hook。**
即使 `napi2native` 在 Linux 上不可用，NapCat 的绝大部分功能仍可用。

封包 hook 只用于「NodeIKernel 拿不到的能力」（如 `send_packet` 裸包发送、
某些 OIDB 操作）。这些是少数场景。

**建议**：Linux 上先不追求封包 hook，把精力放在 NodeIKernel 路径上。

---

## 六、当前状态总结

| 平台 | 签名 | 状态 |
|---|---|---|
| Windows | send/recv | ✅ 唯一命中，与静态表交叉验证一致 |
| Linux | — | ⚠️ 工具链就绪，**卡在需要登录账号** |

### Linux 的具体进度

| 步骤 | 状态 |
|---|---|
| 拿到 Linux QQ 3.2.35-54395 二进制 | ✅ |
| 解析 ELF 节表 / 坐标换算 | ✅ |
| 导出符号分析（885 个 MSF 符号） | ✅ |
| `.eh_frame` 函数枚举（322,547 个） | ✅ |
| GDB attach + 下断点 | ✅ |
| **触发封包收发（需登录）** | ❌ **需要 QQ 账号扫码** |
| 从调用栈定位 hook 点 | ⏸ 待上一步 |
| 采集签名 | ⏸ 待上一步 |

---

## 七、如果一定要做 Linux 签名

按成本排序：

1. **GDB 动态定位 + 登录账号**（§5.1）—— 最可靠。工具链已验证可用，
   只差一个能扫码登录的 QQ 账号。1–2 小时可完成。
2. **缩小范围的暴力测试**（§5.3）—— 半天到一天，风险是频繁崩溃重启。
3. **完整逆向**（IDA）—— 几天。

三种方法都需要**在真实 Linux QQ 上操作**，且要能触发消息收发。

### 建议的下一步

如果你有可用的 QQ 小号：

```bash
# 1. 在 WSL 里启动 QQ，扫码登录
cd /opt/qqroot/opt/QQ && ./qq --no-sandbox &

# 2. 登录后 attach 并下断点
gdb -p $(pgrep -f "^./qq --no-sandbox$" | head -1)
(gdb) b *0x670DD20
(gdb) commands
> silent
> bt 12
> continue
> end
(gdb) c

# 3. 用另一个账号给这个号发消息 / 或让这个号发一条消息
# 4. 把 bt 输出贴回来，就能定位 hook 点
```

拿到调用栈后，我可以在 30 分钟内采集出签名。

---

## 八、工具索引

| 工具 | 用途 |
|---|---|
| `locate-linux-hooks.py` | 测试历史偏移的两种解释（file offset / VA） |
| `align-linux-hooks.py` | 跨版本偏移对齐（需要旧版本二进制） |
| `locate-hooks-by-fde.py` | 用 `.eh_frame` 枚举函数边界（慢） |
| `locate-linux-by-anchor.py` | 从 MSF 符号锚点搜索 |
| `enumerate-functions.py` | 手写 `.eh_frame_hdr` 解析（有 bug，用 readelf 代替） |
| `probe-qq-versions.sh` | 探测旧版本 QQ 下载地址 |
