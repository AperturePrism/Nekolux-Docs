# 决定性实验：x64 3.2.35 codec 函数存活验证

> 日期：2026-11-15
> 环境：Aliyun VPS（Debian, kernel 6.1.0-33-amd64）· x86_64 · QQ Linux 3.2.35-54395（deb 解包，未系统安装）
> 结论：**wrapper.node 编解码层在 x64 3.2.35 上完全存活 —— "x64 结构性失效"结论被推翻，NapCat 式 packet hook 在 Linux x64 上可行**
> 账号安全：全程零登录（仅登录页自主流量），纯内核被动 uprobes，未修改进程内存

---

## 一、背景

此前 strace 观察到 3.2.35 x64 的 socket 系统调用发生在主程序 `qq`（libuv）中而非 `wrapper.node`，据此曾推测"编解码函数已不在此架构调用链上"。但 strace 只证明了**系统调用位置**，不证明 **codec 函数是否仍处理全部流量**——主程序负责 I/O、wrapper.node 负责编解码完全兼容该观察。本实验用内核 uprobes 直接验证 codec 函数是否仍在调用链上。

## 二、方法

### 2.1 观察对象（NapCat fork Part 2 §4 提供，已字节复核）

| 函数 | vaddr | 文件偏移 | 序言字节（复核） |
|---|---|---|---|
| packet send | 0x665CC80 | 0x665BC80 | `55 41 57 41 56 41 55 41 54 53 48 81 ec 88 00 00` |
| packet recv | 0x665EA20 | 0x665DA20 | `55 41 57 41 56 41 55 41 54 53 48 81 ec c8 00 00` |
| napi send | 0x6EBE4D0 | 0x6EBD4D0 | `41 57 41 56 53 48 83 ec 30 49 89 d7` |
| napi recv（32 个同构 stub 之一） | 0x3A49520 | 0x3A48520 | `41 57 41 56 53 48 83 ec 30 4c 8b 7f` |

序言与 fork 的 `PACKET_LINUX_SEND_PATTERN`（帧 0x88）/`PACKET_LINUX_RECV_PATTERN`（帧 0xC8）/`LINUX_SEND_PATTERN` 精确吻合。

### 2.2 关键教训：tracefs MEMADDR 是文件偏移，不是虚拟地址

首两轮实验按 vaddr 注册探针，全零。合成对照实验裁定语义：构造 `p_vaddr ≠ p_offset` 的 .so（`-Wl,-Ttext-segment=0x400000`，gap=0x400000），循环调用 `hotfn` 恰 400 次：

| 编码 | 命中 |
|---|---|
| 文件偏移（vaddr − gap） | **400/400** |
| vaddr | 0/400 |

**内核 `uprobe_events` 的裸地址按文件偏移解释**（`build_map_info` 按 `vm_pgoff` 换算）。wrapper.node 的 RX 段 `p_vaddr=0x299E300 / p_offset=0x299D300`，差 0x1000——按 vaddr 注册的探针全部落在目标入口后 0x1000 字节处，首两轮结果作废。任何在 vaddr≠offset 的二进制上注册 uprobes（tracefs、perf、bpftrace 裸地址形态）都必须先做此换算。

### 2.3 合规性

- **零账号**：QQ 仅停在登录页，心跳/o3 遥测/二维码轮询自主产生流量，无任何 QQ 账号登录
- **纯被动**：内核 uprobes 只插 int3 并由内核处理，不修改进程逻辑、不读写进程内存
- QQ 全程存活（crashpad 无新增 dump；01:29 的旧 dump 属首次启动尝试，早于实验）

## 三、结果

02:15:40 起观察 7 分钟（覆盖约两轮心跳周期）：

| 探针 | 命中 | 判定 |
|---|---|---|
| codec_send（packet 发包引擎） | **39** | ✅ 存活 |
| codec_recv（packet 收包引擎） | **39** | ✅ 存活，与 send 严格 39:39 对称（请求/响应配对） |
| napi_send | **104** | ✅ 存活（高于 codec 层，承载包+其他 NAPI 流量） |
| napi_recv（0x3A49520 stub） | 0 | ❌ 该同构 stub 不在收包路径上 |

样例（napi_send，地址 = 模块基址 + vaddr 0x6EBE4D0，确认探针位置正确）：

```
qq-2738  [001] DNZff  926.174819: napi_send: (0x7fa3a78be4d0)
```

## 四、结论

1. **"x64 结构性失效"被推翻**。主程序 libuv 只承担系统调用层；wrapper.node 的 packet 编解码函数仍看到全部流量。登录页自主流量（心跳/遥测/二维码轮询）以 39 发/39 收完整流经 codec 层。
2. **NapCat 式 packet hook 在 Linux x64 3.2.35 上可行**：packet send（0x665CC80）与 packet recv（0x665EA20）就是可用 hook 点。**对 Nekolux 运行时而言 `send_packet` 并不缺**——闭源 addon 的 QHP1 通道早已双向覆盖（见 `docs/PACKET-HOOK-INTEGRATION.md` §〇）；本结论的价值在 NapCat 生态兼容与独立诊断通道。
3. **napi 层 recv 需要 family indexing**：0x3A49520 这一个 stub 无流量，32 个同构 stub 中活的是哪一个需另行定位（arm64 侧我们已有同族索引方法论；NapCat fork 的 x64 `LINUX_RECV_PATTERN` 用长 dispatch 块区分同族 7 个分发函数）。
4. 观察窗口内登录页速率约 5-6 包/分钟，符合心跳+遥测预期；正式登录后流量密度会高一个数量级以上，hook 价值不变。

## 五、VPS 实验注意事项（运维记录）

- **该机器存在宝塔定时任务：每日 02:00 与 12:00 自动重启**（`/www/server/cron/*`）。任何长窗口实验都会被杀：QQ/Xvfb/ssh 会话/内核探针状态全部丢失。02:00 重启曾一度被误判为"探针导致 QQ 死亡"——journal 显示是干净的 systemd 重启序列，上一轮内核日志无任何 uprobe 相关警告。
- Xvfb/QQ 必须 `setsid nohup` 启动，否则随 ssh 会话消亡（曾致 QQ 因丢失 X 服务器退出且无 dump）。
- crashpad 历史 dump 多为历次启动尝试崩溃，`completed/` 时间戳 ≠ 实验期事件。

## 六、工件

| 文件 | 用途 |
|---|---|
| `tools/reversing/verify-3235x64-offsets.py` | ELF PT_LOAD 映射 + 4 个 vaddr 处字节复核 |
| `tools/reversing/uprobe-semantics-test.sh` | 合成库裁定 tracefs MEMADDR 语义（文件偏移） |
| `tools/reversing/uprobe-redo.sh` | 按文件偏移注册 4 探针 + 300s 观察窗口 |
| `tools/reversing/codec-alive-probe.bt` | bpftrace 方案（v0.17 对 stripped 二进制符号解析失败，已被 tracefs 方案取代） |

## 七、后续

1. ✅ **签名整合已完成（2026-11-15 同日）**：fork 的 4 组 x64 签名 + `.eh_frame_hdr` FDE 函数入口约束 + packet 表值 ×2 语义已整合进 `packages/native-offsets`，端到端验证见 §八
2. VPS 保留 `qq3235x64/` 提取目录作为签名端到端验证的固定测试件（磁盘 93% 满，注意清理策略）
3. ✅ **family indexing x64 版已完成（2026-11-15 同日，见 §九）**：结论为否定——登录页流量零经过该族，零账号方法论对 napi 层 recv 触顶

## 八、签名端到端验证（同日追加）

实验完成当日，4 组签名整合进 `packages/native-offsets` 并在真实二进制上验证（`tools/resolve-offsets.ts`）。**签名解析 → fork 表值 → 本实验 uprobe 实测，三方吻合**：

| 签名 | 解析 RVA | fork 表值（napi2native/packet.json 3.2.35-54395-x64） | 本实验 uprobe |
|---|---|---|---|
| napi send（ELF） | 0x6EBE4D0 | `6EBE4D0` ✓ | 104 命中 ✓ |
| napi recv（ELF，合并签名） | 0x3A49520 | `3A49520` ✓ | 0 命中 ⚠ 活 stub 另寻 |
| packet send（ELF） | 0x665CC80 | `CCB9900`（=2×RVA）✓ | 39 命中 ✓ |
| packet recv（ELF） | 0x665EA20 | `CCBD440`（=2×RVA）✓ | 39 命中 ✓ |

Windows PE 侧同步回归：本地 9.9.36-53644 wrapper.node 上 napi send/recv 解析出 `C3EE2F`/`24A6355`、packet send/recv 表值 `38255F0`/`3828E30`，与 fork 表逐字节一致。

工程要点：`.eh_frame_hdr` FDE 表解析出 322,547 个函数入口（与 WSL 阶段枚举一致），`requireEhFrameEntry` 约束使 recv 同族分发函数收敛到唯一命中；tracefs 文件偏移语义（§2.2）同时写入了内核探针文档。

## 九、napi recv 同族索引实验（同日追加，结论为否定）

### 方法

fork 的 napi recv 目标（0x3A49520）在 §三 中 0 命中，假设之一是"32 个同构 stub 里挑错了"。本实验把整个同族全部挂上探针，用流量找活的成员：

1. **静态枚举**（`tools/reversing/enumerate-napi-recv-family.py`，本地 fixture）：族序言
   `41 57 41 56 53 48 83 ec 30 4c 8b 7f 10 49 83 7f 20 00 0f 84`（je rel32 前）全文件扫描 +
   FDE 入口过滤 → **643 个成员**（远超 fork 所述的 7 / arm64 方法的 32——20 字节序言是
   djinni 回调分发器的通用形状）。fork 表值 stub 为族内 **#184**（stub_184）。
2. **全量 uprobe**（`tools/reversing/uprobe-family.sh`，VPS detached）：643 探针 + 3 个已知点对照
   （pkt_send/pkt_recv/napi_send），双窗口各 210s 交叉验证，QQ setsid 重启于登录页。

### 结果

| 探针 | 窗口1 | 窗口2 |
|---|---|---|
| pkt_send（对照） | 64 | 18 |
| pkt_recv（对照） | **64（1:1 对称）** | **18（对称）** |
| napi_send（对照） | 34 | 50 |
| **643 个同族成员** | **全部 0** | **全部 0** |

646 探针 0 注册失败、字节抽检 8/8 OK、QQ 全程存活无 dump。packet 收发第三次出现完美 1:1 对称。

### 结论

1. **不是挑错 stub——整个 napi recv 族（643 个成员）在登录页零流量。** SSO 消息推送类回调需要登录态才会触发，零账号（登录页）方法论对 napi 层 recv **触顶**：无登录无法验证，而验证恰恰需要登录。
2. napi 层 recv 的可用性只能等生产环境（NAS 登录后）用 packet 签名以外的方式顺带观察，或干脆不依赖它。
3. **packet 层（0x665CC80/0x665EA20）是 Linux x64 上唯一经过流量验证的收发 hook 路径**——而 `send_packet`、收发监听恰好都走这一层，工程上无缺口。
4. 方法论沉淀：646 探针全量注册 + 双窗口计数对进程零伤害，枚举脚本与探针清单可复用于其他族的定位。
