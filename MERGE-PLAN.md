# 合并方案：NapCat × SnowLuma

> 建立日期：2026-11-13
> 状态：阶段 0 完成，偏移签名方案已实现

---

## 0. 决策摘要

| 问题 | 决策 |
|---|---|
| 合并方式 | **重写式融合**，不是 merge 仓库 |
| 基座 | **SnowLuma** |
| NapCat 的定位 | 能力来源 + 偏移逆向能力**独立保留** |
| 第一个交付物 | `packages/native-offsets`（签名扫描替代硬编码偏移表） |

### 为什么不能直接合并代码

两边的 I/O 底座是**平行的两套**：

```
NapCat:    QQ 主进程 → NodeIKernel API → napcat-core → napcat-onebot → action
SnowLuma:  QQ 进程 → 注入 DLL → 命名管道 → protocol(SSO) → core → onebot → action
```

`napcat-onebot` 的 214 个 action 全部依赖 `NapCatCore`（NodeIKernel session），
SnowLuma 的 action 依赖 `BridgeInterface`（封包）。**没有共享层可以插进去。**

---

## 1. 为什么选 SnowLuma 当基座

| # | 理由 | 证据 |
|---|---|---|
| 1 | 架构方向正确 | 进程外 hook 是 QQ 生态的必然方向 |
| 2 | **迁移量不对称** | 补插件系统 ≈ 20% 工作量；换 hook ≈ 90% |
| 3 | 多账号 | SnowLuma 原生支持，NapCat 架构上做不到 |
| 4 | Linux 原生 | 实测通过（见 `reports/PHASE0-LINUX-VERIFICATION.md`） |
| 5 | 不依赖版本表 | 对「上游已死」是决定性的 |

### 反方观点（诚实记录）

如果你最看重**现成插件生态**，NapCat 是唯一选择。但上游已死，生态也不会再增长。

---

## 2. 目录结构

```
unified/
├─ packages/
│  └─ native-offsets/              # ← 本阶段唯一交付物
│     ├─ src/
│     │  ├─ signature.ts           # 通配符签名解析 + 扫描
│     │  ├─ binary.ts              # PE/ELF 解析 + 三套坐标换算
│     │  ├─ resolver.ts            # 主流程 + 交叉验证
│     │  └─ signatures/
│     │     └─ napcat-hooks.ts     # NapCat send/recv 签名（实测采集）
│     └─ tests/                    # 37 个测试
├─ tools/
│  ├─ resolve-offsets.ts           # 运行时 CLI
│  └─ reversing/                   # 离线逆向工具（Python）
│     ├─ analyze-hook-sig.py       # 验证签名唯一性
│     ├─ offset_resolver.py        # 通用坐标解析（来自 LLQQNT）
│     └─ README.md
└─ docs/
   ├─ MERGE-PLAN.md                # 本文件
   ├─ OFFSET-MAINTENANCE.md        # 偏移维护指南
   └─ NAPCAT-OFFSET-REVERSING.md   # NapCat 逆向能力（独立保留）
```

> 后续阶段会把 SnowLuma 的 14 个包和 NapCat 的能力移植进来。
> 当前只落地了第一个包，因为它是**解决实际问题的最小可交付单元**。

---

## 3. 为什么先做 native-offsets

不是随意选的，而是因为它是**唯一一个能立刻解决实际阻塞**的模块：

### 3.1 问题

阶段 0 验证时发现：

```
Linux QQ 3.2.35-54395 + NapCat napi2native
→ initHook 用 3.2.34 的偏移
→ Segmentation fault
```

NapCat 的 `napi2native.json` 硬编码了每个版本的偏移，表里没有的版本直接崩溃。

### 3.2 上游已死

- NapCat 官方仓库 2026-11-12 删库
- 20 个 fork 全部止于 3.2.34
- 腾讯的 Linux QQ 下载页给的是 2025-06 的失效链接

**没人会再维护那张表。**

### 3.3 解法

实测发现 NapCat 的偏移是 **RVA**（不是 file offset），且 hook 点精确落在
**标准 x64 函数序言**上。这意味着可以用**字节特征**定位，不需要版本表。

### 3.4 结果

```bash
$ pnpm resolve-offsets <wrapper.node>

[HIT] napcat.wrapper.send
      file_offset=0xc3e22f  rva=0xc3ee2f  va=0x180c3ee2f  section=.text
[HIT] napcat.wrapper.recv
      file_offset=0x24a5755  rva=0x24a6355  va=0x1824a6355  section=.text
=> 全部签名命中唯一，可直接用于 hook。
```

**解析出的 RVA 与 NapCat 静态表精确一致**，证明可无缝替代。

---

## 4. 两套偏移能力的分工（按你的要求）

你要求「NapCat 逆向新 wrapper.node 算出偏移作为独立保留」。已实现：

| | 签名扫描 | 偏移逆向 |
|---|---|---|
| 位置 | `packages/native-offsets` | `docs/NAPCAT-OFFSET-REVERSING.md` + `tools/reversing/` |
| 输入 | 二进制 + 字节特征 | 二进制 + 符号/调用关系 |
| 适用 | **常规升级**（首选） | 签名失效时（兜底） |
| 自动化 | ✅ 全自动 | ❌ 人工 |
| 跨版本 | 预期稳定 | 每次都要重做 |

**工作流**：

```
QQ 升级
  ↓
pnpm resolve-offsets
  ↓
命中唯一？ ──是──→ 直接可用（最常见）
  │
  否
  ↓
按 NAPCAT-OFFSET-REVERSING.md 手工定位
  ↓
用 analyze-hook-sig.py 验证新位置
  ↓
更新签名表
```

`tools/reversing/` 保留了两个 Python 工具：

- `analyze-hook-sig.py` —— 从实测偏移出发，分析唯一性、生成签名候选
- `offset_resolver.py` —— 通用 PE/ELF 坐标换算（来自 LLQQNT，处理文件校验补丁）

---

## 5. 验证记录

### 5.1 阶段 0（详见上级目录报告）

| 项 | Windows | Linux |
|---|---|---|
| SnowLuma 构建 | ✅ | ✅ |
| SnowLuma typecheck | ✅ 14/14 | ✅ 14/14 |
| SnowLuma 测试 | ⚠️ 1501/1504 | ⚠️ 1501/1504 |
| SnowLuma 注入 | ✅ | ✅ |
| SnowLuma 握手 | ✅ QHP1 | ✅ QHP1 |
| NapCat 构建 | ✅ | — |
| NapCat 封包 hook | ✅ 表内有版本 | ❌ 表内无版本 |

### 5.2 native-offsets

```
Test Files  3 passed (3)
     Tests  37 passed (37)
```

包含对真实 117MB `wrapper.node` 的集成测试：

- send 签名唯一命中 → RVA `0xc3ee2f` ✓ 与 NapCat 表一致
- recv 签名唯一命中 → RVA `0x24a6355` ✓ 与 NapCat 表一致
- 两个点都落在 `.text` 且以函数序言开头
- RVA ↔ file offset 双向换算一致

---

## 6. 后续阶段

### 阶段 1：补齐 action 缺口（进行中）

**2026-11-13 实测的真实缺口（用运行时 `ACTION_REGISTRY.executableNames` 对比，排除测试项）：**

已完成（3 个，都是「已有能力换个名字暴露」）：

| Action | 做法 |
|---|---|
| `set_custom_face_desc` | `modify_custom_face` 的别名 —— 同一个 OIDB 0x902e |
| `get_qzone_comment_list` | `get_qzone_msg_detail` 的别名 —— 同一份数据（含 commentlist 分页） |
| `upload_images_to_qun_album` | 新实现：循环调用 `groupAlbum.upload`，逐张返回结果 |

剩余 9 个：

| 优先级 | Action | 阻塞点 |
|---|---|---|
| P2 | `get_robot_uin_range` | 需逆向 NodeIKernel 的 RobotService 对应 OIDB |
| P2 | 在线文件传输（5 个） | 需逆向 `OnlineApi` 的协议 |
| P3 | `get_guild_list` / `get_guild_service_profile` | QQ 频道，需从零逆向协议 |
| ❌ | `send_packet` | 依赖封包 hook，**Linux 3.2.35 不可用** |

> **重要修正**：之前两次缺口分析都是错的。
> 第一次说「23 个」，第二次说「13 个」，实际是 **12 个**（`set_custom_face_desc` 补上后剩 11 个，
> 再补 2 个别名后剩 9 个）。
>
> 错误原因：
> 1. grep `name: 'xxx'` 漏掉数组形式 `name: ['xxx', 'alias']`
> 2. `comm` 对比前没排序
> 3. 没有运行时验证，只看静态文本
>
> **正确做法**：用 `ACTION_REGISTRY.executableNames` 拿到真实清单再对比。

> **另注**：`ocr_image`、`fetch_ptt_text`、`send_group_sign`、`set_group_sign`、`get_rkey`
> 之前被我列为缺口，实际 SnowLuma **早就实现了**。

### 阶段 2：插件系统（核心已完成）

**2026-11-13 完成**：`packages/plugin`，30 个测试通过。

| 组件 | 状态 |
|---|---|
| 公共契约（ctx / 钩子 / 配置 schema） | ✅ |
| 加载器（白名单 / 目录校验 / 敏感词 / 防逃逸） | ✅ |
| 管理器（生命周期 / 事件分发 / 配置持久化） | ✅ |
| action 注册表（只增不改 / 自动回滚） | ✅ |
| **接入 SnowLuma 运行时** | ✅ 事件分发 + action 回退 |
| WebUI 插件管理页 | ⏳ 未做 |
| 插件市场 | ⏳ 未做 |

**接入点**（2026-11-13 完成）：

| 文件 | 改动 |
|---|---|
| `snowluma/src/packages/onebot/src/instance.ts` | `setPluginBridge()` + 事件分发 |
| `snowluma/src/packages/onebot/src/api-handler.ts` | `setPluginActionResolver()` + 回退 |
| `snowluma/src/packages/onebot/src/manager.ts` | 转发给所有实例 |
| `unified/packages/plugin/src/snowluma-bridge.ts` | 适配器 |

测试：新增 5 个（`plugin-action-fallback.test.ts`）+ 6 个桥接测试。

**关键设计决策**（详见 [`PLUGIN-SYSTEM.md`](PLUGIN-SYSTEM.md)）：

- **不照抄 NapCat**：`ctx.core`（NodeIKernel session）在 SnowLuma 里不存在，插件只能注册 action
- **白名单默认空**：插件能注册任意 action，默认放行等于默认信任任意代码
- **action 只增不改**：覆盖内置 action 会让排障变噩梦
- **异常隔离**：单个插件崩溃不影响事件流和其他插件

**下一步**：接入 `OneBotInstance`（事件管道末尾 dispatch、api-handler 插件回退）。

NapCat 的插件系统是最有价值的独有资产。移植要点：

- 生命周期：`plugin_init(ctx)` / `plugin_unload()` / 配置 schema
- `ctx` 接口要**重新设计**：NapCat 的 `ctx.core` 是 `NapCatCore`（NodeIKernel），
  SnowLuma 是 `BridgeInterface`（封包），语义不同
- WebUI 要重新做（SnowLuma 用 React19+Tailwind，NapCat 用 HeroUI）

### 阶段 3：Linux 签名采集（已调查，结论：架构变更，不再推进）

完整调查见 [`LINUX-HOOK-INVESTIGATION.md`](LINUX-HOOK-INVESTIGATION.md)。

**结论**：QQ Linux 3.2.35 把网络层搬到了主程序的 libuv，`wrapper.node` 不再参与网络 I/O。
NapCat 的封包 hook 架构在 Linux 3.2.35 上已失效。

**但主路径（NodeIKernel）完全可用** —— 已在 VPS 上实测 NapCat v4.18.42 跑通
（WebUI 6099、二维码登录、OneBot 网络适配均正常）。

### 阶段 4：长尾能力

频道（guild）、在线文件传输、群管理员权限细分。
频道需要逆向频道协议，成本最高，建议最后做或不做。

---

## 7. 风险

| 风险 | 等级 | 现状 |
|---|---|---|
| 上游已死 | 🔴 | 已确认，本项目即应对措施 |
| 原生二进制无源码 | 🔴 | 两边都是预编译，失效无法自修 |
| 许可限制 | 🟠 | 仅自用，公开需授权 |
| 签名跨版本未验证 | 🟡 | 只有 9.9.36-53644 单版本实测 |
| Linux 签名缺失 | 🟡 | 封包 hook 在 Linux 暂不可用 |

### 关于「签名跨版本未验证」

这是当前方案**最大的未知**。9.9.36-53644 上唯一命中，但没有第二个版本的
二进制做对照。要真正确认跨版本稳定，需要：

1. 拿到 9.9.35 或 9.9.37 的 `wrapper.node`
2. 跑 `pnpm resolve-offsets`
3. 看是否仍唯一命中，且 RVA 与静态表一致

如果拿不到旧版本，就只能等 QQ 下次升级时自然验证。

---

## 8. 与 LLQQNT 的关系

上级目录 `LLQQNT/` 是独立项目（LiteLoaderQQNT fork），解决 QQ 文件校验绕过。
它的 `OFFSET-RESOLUTION.md` 记录了同样的方法论：

| | LLQQNT | 本项目 |
|---|---|---|
| 目标 | 校验函数 `call memcmp` | MSF 网络层函数入口 |
| 签名 | 18 B，无通配 | 53/110 B，有通配 |
| 跨版本 | 9.9.32→9.9.36 未改 | 待验证 |

LLQQNT 的 §10「sig 失效时怎么重新定特征」可直接套用。
`offset_resolver.py` 已复制到 `tools/reversing/` 复用其坐标换算逻辑。
