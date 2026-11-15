# Linux 封包 Hook 调查结论

> 调查日期：2026-11-13
> 环境：阿里云 VPS（Debian 12，x86_64，2核2G）· QQ Linux 3.2.35-54395
> 结论：~~Linux 3.2.35 上 NapCat 的封包 hook 架构已失效~~
> **【2026-11-15 修正】封包 hook 架构未失效——本文把「系统调用位置」误读成了「codec 不参与」。修正见 §十 与 [reports/X64-CODEC-ALIVE-EXPERIMENT.md](/reports/X64-CODEC-ALIVE-EXPERIMENT)**

---

## 一、一句话结论

~~**NapCat 的 Linux 封包 hook 依赖 `wrapper.node` 内的函数偏移。QQ 3.2.35 把网络层搬到了主程序的 libuv 里，`wrapper.node` 不再参与网络 I/O，因此偏移表失效。**~~

**【2026-11-15 修正】** 3.2.35 是**两层分工**，不是迁移：

```
wrapper.node codec 层：协议编解码 + 加解密（packet send/recv 函数）
        ↓ 编码后的字节
主程序 libuv：系统调用（socket write/recv）
        ↓
内核
```

主程序 libuv 承担 I/O 属实（本文 §二的数据没错），但 **codec 层仍然处理全部流量**——它本来就不该出现在系统调用栈上。内核 uprobe 直接验证：登录页零账号流量 7 分钟内 packet send/recv 各命中 39 次、严格 39:39 对称，napi send 104 次。NapCat 式 packet hook 挂的就是 codec 层，**偏移表（packet.json `CCB9900`/`CCBD440`）与签名解析完全可用**。

本文其余章节保留原始调查记录；被修正的判断在 §十 逐条标注。

---

## 二、实测证据

### 2.1 `wrapper.node` 不参与网络

用 LD_PRELOAD 拦截 `write` / `writev` / `connect`，记录完整调用栈（`backtrace()`），解析每个返回地址所属模块：

| 模块 | 出现次数 | 角色 |
|---|---|---|
| `qq`（主程序） | 289+ | **libuv 网络层** |
| `libxcb` / `libX11` | 500+ | X11 图形 |
| `libc` | 250+ | 系统调用 |
| `libdbus` | 25 | D-Bus |
| **`wrapper.node`** | **仅 X11 路径** | 不参与网络 |

关键记录：

```
W 83 153 <hook> <hook> 0x55b4e7cf759d
# fd 83 = socket 到 43.137.25.80:443（QQ 服务）
# 0x55b4e7cf759d → qq +0x2a9159d → libuv 的 uv__stream 内部
```

`wrapper.node` 出现的所有记录都是 `libX11 → libxcb → wrapper.node` 的渲染路径。

### 2.2 `wrapper.node` 的网络能力是"备用"的

```bash
$ nm -D -u wrapper.node | grep -E "uv_|send|recv|connect"
U connect@GLIBC_2.2.5
U send@GLIBC_2.2.5
U recv@GLIBC_2.2.5
U socket@GLIBC_2.2.5
U uv_tcp_connect
U uv_tcp_init
U uv_write
```

它**导入了完整的网络 API**，但运行时没被用来收发 QQ 封包。

### 2.3 NapCat 的两个 hook 点均未命中

| 断点 | 地址 | 结果 |
|---|---|---|
| `MSFSDK::sendPacket` | `wrapper+0x670dd20` | ❌ 未命中 |
| `uv_write` | `qq+0x2a91360` | ❌ 未命中 |
| `wrapper` 内 `uv_write@plt` 调用点 | `wrapper+0x89f409b` | ❌ 未命中 |
| `wrapper` 内 `uv_write@plt` 调用点 | `wrapper+0x34cbaae` | HTTP 服务器，非 SSO |

### 2.4 `wrapper.node` 只做协议编解码

```bash
$ strings wrapper.node | grep -c "^trpc\."
240
```

有 240 个 SSO 命令字符串（`trpc.login.ecdh...`、`OidbSvcTrpcTcp.0x...`），但：
- 这些字符串在 `.rodata`，没有直接的 `lea` 引用
- 对应的函数在 `.text` 里没有导出符号
- 运行时断点证明它们不发网络包

**判断**：`wrapper.node` 提供 `NodeIQQNTWrapperSession` 等 API 给主程序，负责**协议序列化/反序列化**；网络收发由主程序的 libuv 负责。

---

## 三、架构对比

| 平台 | 网络层位置 | 封包 hook 可行性 |
|---|---|---|
| Windows 9.9.x | `wrapper.node` 的 `MSFSDK` | ✅ 有偏移表，已验证 |
| Linux 3.2.34 及更早 | `wrapper.node`（NapCat 表有数据） | ✅ 推测可用 |
| **Linux 3.2.35** | codec 在 `wrapper.node`，I/O 在主程序 libuv | ✅ **【11-15 修正】codec 层存活，签名可用**（原判 ❌ 作废） |

### 调用链（3.2.35 实测）

```
QQ 应用层（C++/Node.js）
  ↓
libuv（内嵌在 qq 主程序）
  ↓
libc write() / send()
  ↓
内核
```

`wrapper.node` 在**应用层的协议编解码**位置，不在 I/O 路径上。

---

## 四、能做到什么 / 做不到什么

### 能做到

| 能力 | 方法 | 状态 |
|---|---|---|
| 抓所有出站字节 | LD_PRELOAD hook `write`/`writev` | ✅ 已实现 |
| 识别封包边界 | fd + 长度特征 | ✅ 已实现 |
| 统计连接行为 | hook `connect` | ✅ 已实现 |
| 拿到加密后的密文 | 同上 | ✅ |

### 做不到（或成本极高）

| 能力 | 阻塞原因 |
|---|---|
| 拿到明文 `cmd` / `seq` / `body` | 加密层在主程序的 Node.js 里，无符号 |
| 复现 `send_packet` | 需要构造合法 SSO 包（加密 + 序列号 + 会话状态） |
| 复用 NapCat 偏移表 | 偏移指向 `wrapper.node`，但网络不在那里 |

### 为什么不再深入

1. **主程序无符号** —— `qq` 是 stripped 的 204MB 二进制，MSF 应用层代码无法定位
2. **每次更新会变** —— 即使逆向出来，QQ 大版本更新后要重做
3. **收益有限** —— 主路径（NodeIKernel）已覆盖 214 个 action 中的绝大多数

---

## 五、验证：主路径完全可用

在同一台 VPS 上部署 NapCat v4.18.42 实测：

```
[NapCat] [Worker] 已预加载 Node Addon: napi2native.linux.x64.node
NapCat Shell App Loading...
[NapCat] [Core] NapCat.Core Version: 1.0.0-dev
[NapCat] [WebUi] WebUi Token: ba89279f2c14
[NapCat] [WebUi] WebUi User Panel Url: http://127.0.0.1:6099/webui?token=...
二维码已保存到 /opt/napcat/cache/qrcode.png
```

**结论**：NodeIKernel 路径在 Linux 3.2.35 上完全正常，WebUI、二维码登录、OneBot 网络适配都能跑。

封包 hook 缺失只影响：
- `send_packet`（裸包发送）
- 少数需要直接构造 OIDB 包的能力

---

## 六、复现方法

### 6.1 LD_PRELOAD 抓 write

```bash
# 编译
gcc -shared -fPIC -O1 -fno-omit-frame-pointer -o libqqwrite.so qq-write-hook.c -ldl -lpthread

# 启动
DISPLAY=:99 LD_PRELOAD=/tmp/libqqwrite.so ./qq --no-sandbox

# 分析
python3 analyze.py <pid>   # 解析 /tmp/qq-write-hook.log
```

### 6.2 关键工具

| 文件 | 用途 |
|---|---|
| `tools/reversing/qq-write-hook.c` | write/writev 拦截器（含 backtrace） |
| `tools/reversing/collect-linux-signature.sh` | 采集脚本 |
| `tools/reversing/verify-packet-rva.py` | 验证 packet.json 的 RVA 语义 |
| `tools/reversing/locate-linux-by-anchor.py` | 符号锚点定位 |
| `tools/reversing/align-linux-hooks.py` | 跨版本对齐 |

### 6.3 环境搭建（Debian 12）

```bash
# 依赖
apt-get install -y libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6 \
  xdg-utils libatspi2.0-0 libsecret-1-0 libgbm1 libasound2 \
  xvfb x11vnc openbox imagemagick gdb strace

# QQ
curl -o qq.deb "https://qqdl.gtimg.cn/qqfile/QQNT/9.9.37/beta/816b3c79/linuxqq_3.2.35-54395_amd64.deb"
dpkg-deb -x qq.deb qqroot

# 显示
Xvfb :99 -screen 0 1280x800x24 &
DISPLAY=:99 openbox &
x11vnc -display :99 -forever -shared -nopw -rfbport 5900 &
```

---

## 七、踩过的坑

| 问题 | 原因 | 解决 |
|---|---|---|
| gdb attach 后 QQ 崩溃 | `timeout` 杀 gdb 后线程停在 `T` 状态 | 改用 LD_PRELOAD |
| strace `-p` 冻结所有线程 | `SIGSTOP` 目标进程 | 弃用 |
| `__builtin_return_address(3)` segfault | 栈帧越界 | 改用 `backtrace()` |
| WSL 里 QQ 反复崩溃 | WSLg 的 GPU ioctl 失败 | 换真实 Linux（VPS） |
| 腾讯官网 Linux QQ 链接 404 | 官方页面是 2025-06 的失效链接 | 从 AUR PKGBUILD 提取真实地址 |
| VNC 黑屏 | 缺窗口管理器 | 装 openbox |

---

## 八、对项目的建议

> 【2026-11-15 修正】基于 §十 的实验结论重写；原建议（"Linux 上不追求封包 hook"）作废。

### 短期

1. **Linux 封包 hook 恢复可行** —— codec 层存活已证实，签名已整合进 `packages/native-offsets`（napi send/recv + packet send/recv，ELF x64，3.2.35-54395 端到端验证与 fork 表值三方吻合）
2. **Windows 保持现状** —— 签名已验证，偏移表可用
3. **文档标注平台差异** —— napi 层 recv 的活 stub 待同族索引定位（见下）

### 长期

| 方案 | 成本 | 可行性 |
|---|---|---|
| **packet 层 hook（packet.json 签名）** | 低 | ✅ 签名唯一命中 + 流量证实。**注意：Nekolux 运行时的 `send_packet` 早已由闭源 addon 的 QHP1 通道覆盖**（`PipeOp.recvPacket`/`sendRequest`，NAS 生产实测）；本签名的价值 = NapCat 生态兼容 + 独立诊断通道（`native/packet-hook/`），见 `docs/PACKET-HOOK-INTEGRATION.md` §〇 |
| napi 层 recv 的活 stub 定位 | — | ❌ **零账号方法论触顶**（2026-11-15 同族索引实验：643 个族成员在登录页全部 0 流量，见 `reports/X64-CODEC-ALIVE-EXPERIMENT.md` §九）——napi 层 recv 只在登录后才有 SSO 推送流量，packet 层已覆盖工程需求，不再追求 |
| ~~降级到 Linux QQ 3.2.34~~ | — | 不再需要 |

---

## 九、相关文档

- `docs/OFFSET-MAINTENANCE.md` —— 签名扫描方案（Windows）
- `docs/NAPCAT-OFFSET-REVERSING.md` —— 逆向方法论
- `docs/MERGE-PLAN.md` —— 合并方案
- `reports/PHASE0-LINUX-VERIFICATION.md` —— 阶段 0 Linux 验证（SnowLuma）
- `reports/X64-CODEC-ALIVE-EXPERIMENT.md` —— **2026-11-15 决定性实验（本文结论的修正来源）**

---

## 十、2026-11-15 修正：codec 层存活的决定性证据

> 完整方法、合规性与运维记录见 `reports/X64-CODEC-ALIVE-EXPERIMENT.md`。此处只列对本文各节的逐条修正。

| 本文原判断 | 修正 | 证据 |
|---|---|---|
| §2.1 "wrapper.node 不参与网络" | 数据正确，解读错误：**系统调用**在主程序 libuv，**编解码**仍在 wrapper.node | uprobe：packet send/recv 7 分钟各 39 命中、39:39 对称 |
| §2.2 "网络 API 导入了但没被用" | wrapper.node 确不经手系统调用——codec 层本就不该出现在 syscall 栈上，此条不能作为失效证据 | 分层模型（§一） |
| §2.3 "NapCat 两个 hook 点均未命中" | 探测的偏移（`wrapper+0x670dd20`）不是表值——3.2.35 x64 的 napi send 是 `0x6EBE4D0`、packet send 是 `0x665CC80`；正确地址的 uprobe 全部命中 | fork napi2native.json / packet.json 3.2.35-54395-x64 条目 + 字节复核 |
| §2.4 "不发网络包" | codec 层不发**系统调用**，但收发**封包字节流**——MoeHoo 式 hook 挂的就是这一层 | 39:39 对称命中 |
| §四 "拿不到明文 cmd/seq/body" | 加解密在 codec 层（有签名可定位），不在主程序 Node.js | packet.json 的 MoeHoo 监听即取明文 |
| §四 "复现 send_packet 成本极高" | 调用 packet send 函数入口（签名唯一命中）即可构造裸包 | NapCat 同机制 |
| §五 "缺 send_packet" | 缺口可补 | 同上 |

实验本身零账号（登录页自主流量）、纯内核被动 uprobes、未修改进程内存；QQ 全程存活、crashpad 零新增 dump。另：本文 §七 的坑表之外补充两条——**内核 tracefs uprobe_events 的裸地址是文件偏移而非 vaddr**（wrapper.node RX 段两者差 0x1000，签错位置全零命中），以及**该 VPS 有宝塔定时任务每日 02:00/12:00 重启**（长实验窗口必被杀，曾一度被误判为探针致 QQ 死亡）。
