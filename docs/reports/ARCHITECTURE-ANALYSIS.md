# NapCat × SnowLuma 架构对比与融合可行性分析

> 生成日期：2026-11-13
> 分析对象：NapCat v4.18.42（归档于 `XingYunStar/NapCatQQ`）· SnowLuma v2.4.2（归档于 `TomyJan/SnowLuma`）
> 本地路径：`D:\Project\nc+sl\NapCatQQ-src` · `D:\Project\nc+sl\SnowLuma-src`

---

## 0. 先说结论

| 问题 | 结论 |
|---|---|
| 两者能直接合并代码吗？ | **不能。** 底层接入方式根本不同（进程内 NodeIKernel API vs 进程外 协议包 hook），协议层无法共享。 |
| 能做深度融合吗？ | **能，但只能是「重写式融合」**：选一个基座，把另一方的**设计模式与能力清单**移植过去，而不是 merge 仓库。 |
| 谁更适合当基座？ | **SnowLuma**（理由见 §7）。但如果你最看重「现成插件生态 + 社区」，则 NapCat。 |
| 最大风险 | 两个项目**都已停止维护**（NapCat 官方删库、SnowLuma 官方 404）。融合产物将**没有上游可跟**，QQ 每次更新都要自己修 hook 偏移。 |
| 许可 | 两者都**禁止公开发布修改版**。融合产物只能自用，公开需作者书面授权。 |

---

## 1. 源码获取现状

### 1.1 官方仓库状态

| 项目 | 官方地址 | 状态（2026-11-13 核实） |
|---|---|---|
| NapCatQQ | `NapNeko/NapCatQQ` | **已删光源码**。只剩 README「## Ending / 到这里告一段落。」，1KB，2 个 commit。最后有效 tag `v4.18.42`。 |
| SnowLuma | `SnowLuma/SnowLuma` | **已删除**，GitHub 返回 404。npm 上 `@snowluma/sdk` / `@snowluma/mcp` 仍为 2.4.2。 |

### 1.2 采用的镜像

| 项目 | 镜像 | 依据 | 本地路径 |
|---|---|---|---|
| NapCat | `XingYunStar/NapCatQQ` | 1111 文件、TypeScript、含完整 git 历史与 `v4.18.42` tag、最后 commit `72912f29 docs: ending` 与官方删库时间吻合 | `NapCatQQ-src/` |
| SnowLuma | `TomyJan/SnowLuma` | ⭐389，1367 文件、1319 commits、`v2.4.2` tag、含 `dev` 分支（领先 main 5 个 commit）、含全部 14 个 package | `SnowLuma-src/` |

其他备选镜像：`VanillaNahida/NapCatQQ`（与 XingYunStar 同源）、`XingYunStar/snowluma`（48⭐）、`zhx57/SnowLuma`（13⭐）。

### 1.3 你手上那份 `SnowLuma/` 目录

**没有逆向价值。** 它是发行包，`index.mjs` 是 12MB 的 rolldown 单文件 bundle，无 sourcemap，`native/` 下是预编译二进制。源码镜像里有完整 TS 原文，直接用 `SnowLuma-src/`。

---

## 2. 规模与工程化对比

| 指标 | NapCat | SnowLuma |
|---|---|---|
| TS/TSX 文件 | 926 | 1216 |
| TS 代码行 | 111,242 | 316,628 |
| package 数 | 26 | 14 |
| 单元测试文件 | 52（集中在 `napcat-test`） | **509**（分散在各 package） |
| 运行时 npm 依赖 | `ws`、`express`（external，需随包分发） | **0**（单文件 bundle + `dlopen` 原生模块） |
| Node 版本要求 | ≥18 | **24.22.1+ / 26.12.1+** |
| 包管理器 | pnpm 9 | pnpm 11.25.0 |
| CI 工作流 | 5 个 | **13 个**（含 npm 发布、catalog 漂移检查、issue 守卫） |
| 产物形态 | `napcat.mjs`（依赖外部 node_modules） | `index.mjs` 单文件 + `native/` |
| 文档站 | `napcat.napneko.icu`（VitePress） | `snowluma.github.io`（VitePress）+ 4 个独立 npm 包 README |

**判读**：SnowLuma 代码量是 NapCat 的近 3 倍，但其中约 40% 在 `protocol`（31,863 行）——那是它自己实现全套 二进制协议 编解码的代价。NapCat 走 NodeIKernel API，同样的功能只需 27,296 行 `napcat-core`。

---

## 3. 核心架构差异（决定性差异）

### 3.1 接入 QQ 的方式

#### NapCat —— 进程内（in-process）

```
QQ.exe 启动
  └─ package.json 的 "main" 被改成 ./loadNapCat.js
       └─ loadNapCat.js  import(NAPCAT_MAIN_PATH)  →  napcat.mjs
            └─ 直接在 QQ 主进程里运行 NapCat
                 ├─ 拿到 NodeIQQNTWrapperSession（QQ 自己的 核心模块 导出）
                 ├─ 调用 session.getMsgService() / getGroupService() …（46+35 处调用）
                 └─ 通过 NodeIKernelMsgListener 等监听器接收事件
```

**关键点**：NapCat 就是 QQ 主进程的一部分。它用的是 QQ 自己的 JS 对象和方法，不碰网络层。

- 优势：能力最全（QQ 内部有什么就能用什么），实现简单，不需要理解 SSO/二进制协议
- 劣势：**与 QQ 版本强耦合**。QQ 改一个内部 API 签名就挂。单进程只能跑一个账号。Linux 需要替换 `核心模块`（就是你的 `NapCatLinuxNodeLoader` 干的事）

#### SnowLuma —— 进程外（out-of-process hook）

```
SnowLuma 独立进程启动
  └─ process.dlopen(snowluma-win32-x64.node)
       └─ native.loadModuleManualAsync(pid, snowluma-win32-x64.dll)   // 手动映射注入 QQ
            └─ DLL 在 QQ 进程内 hook 两个函数（send / recv）
                 └─ 通过 mojo 命名管道与 SnowLuma 通信
                      Windows: \\.\pipe\mojo.<pid>.<suffix>
                      Linux:   /run/user/.../mojo.<pid>.control.sock
                        └─ 管道帧格式：cmdLen | msgLen | bodyLen | cmd | msg | body
                             └─ SnowLuma 侧自己 encode/decode 协议包（二进制协议）
```

**关键点**：SnowLuma 只 hook 两个函数地址，然后**在进程外自己实现整套协议**。

- 优势：与 QQ 版本**弱耦合**（只需函数偏移，见 §4.2），天然支持多账号（一个进程管多个 QQ 实例），Linux 原生支持，崩溃不拖死 QQ
- 劣势：要实现全部 二进制协议 cmd，代码量巨大（`protocol/src/oidb-services` 117 个文件 / 548KB）；某些 QQ 内部能力（NodeIKernel 才有的）拿不到

### 3.2 这个差异意味着什么

**这不是「实现细节不同」，是「两条技术路线」。**

| | NapCat 路线 | SnowLuma 路线 |
|---|---|---|
| 抽象层级 | QQ 的 JS API（高） | SSO 二进制封包（低） |
| 需要理解 | QQ 内部对象模型 | QQ 协议（二进制协议/Protobuf/Highway） |
| QQ 升级影响 | **大**（API 变更即挂） | 小（只有 hook 偏移变） |
| 新功能开发成本 | 低（QQ 有接口就能调） | 高（要逆向协议） |
| 代码量 | 小 | 大 |

**融合含义**：不能「NapCat 的 action 调 SnowLuma 的 protocol」，因为 SnowLuma 的 protocol 依赖它自己的 `Bridge`（管道 + 封包），而 NapCat 的 action 依赖 `NapCatCore`（NodeIKernel session）。**两边是平行的两套 I/O 底座。**

---

## 4. 分层架构对照

### 4.1 包结构映射

| 层 | NapCat | SnowLuma | 可复用性 |
|---|---|---|---|
| **接入/注入** | `napcat-shell-loader`（DLL + loadNapCat.js）、`napcat-shell` | `bridge`（5,582 行：injector / hook-manager / pipe-watcher / qq-account） | ❌ 互斥 |
| **原生模块** | `napcat-native`（MoeHoo 协议层拦截、napi2native、ffmpeg、pty、dpapi） | `runtime/native`（snowluma-*.node/.dll/.so、websocket、sqlite、ffmpeg） | ❌ 互斥 |
| **核心 API 层** | `napcat-core/apis`（4,836 行，13 个 官方客户端*Api 类，包 NodeIKernel） | `core/src/bridge/apis`（9,230 行，19 个区域 Api） | ⚠️ 接口可对齐，实现不可复用 |
| **协议层** | `napcat-core/packet`（transformer 74 文件 + handler）—— **只用于少数 NodeIKernel 拿不到的能力** | `protocol`（31,863 行：oidb-services 117 文件、msg-push、highway、dataline、web） | ⚠️ SnowLuma 的协议实现是资产 |
| **事件转换** | `napcat-onebot/event` + `listeners` | `onebot/src/event-converter` + `protocol/msg-push/decoders` | ✅ 设计可借鉴 |
| **OneBot 动作** | `napcat-onebot/action`（214 文件 / 12,174 行，class-per-action + TypeBox + 装饰器） | `onebot/src/actions`（216 action / 468KB，声明式 `defineAction` + `f.*` DSL） | ✅ **这是最有价值的互补点** |
| **网络适配** | `napcat-onebot/network`（ws-server / ws-client / http-server / http-client / http-sse / plugin） | `onebot/src/network`（同名 5 种 + `network-manager` 的 reconcile 模型） | ✅ 语义基本一致 |
| **插件系统** | `napcat-onebot/network/plugin*`（完整：配置 schema → 自动生成 UI、WebUI 路由、插件市场、白名单） | **无** | ❗ NapCat 独有资产 |
| **WebUI** | `napcat-webui-frontend`（191 文件 / 32MB 源码）+ `-backend`（52 文件，Express） | `webui`（175 文件 / 1.9MB，React19+Tailwind4+TanStack）+ `core/src/webui`（30 文件，Hono） | ⚠️ 两套都要重写前端，后端设计可借鉴 |
| **SDK / MCP** | 无 SDK；有 `napcat-schema` 生成 OpenAPI | `sdk`（58 文件）+ `mcp`（34 文件 + 597KB catalog） | ❗ SnowLuma 独有资产 |
| **存储** | `napcat-database`（5 文件，只读解密 **QQ 自己的** NTDB，供内部查询）+ `napcat-common/store`（内存 Map）—— **没有 OneBot 消息历史持久化** | `sqlite`（自研 native driver）+ `onebot/message-store`（SQLite + WAL + 迁移 + 索引）+ `history-sync` | ❗ SnowLuma 独有资产 |
| **多账号** | ❌ 单账号 | ✅ 按 uin 分 session、分 `onebot_<uin>.json`、分消息库 | ❗ SnowLuma 独有资产 |

### 4.2 版本抗性对比（关键数据）

**NapCat**：`napcat-core/external/napi2native.json` 记录 hook 函数偏移：
```json
{ "9.9.22-40990-x64": { "send": "1B5699C", "recv": "1D8CA9D" },
  "3.2.20-40768-x64": { "send": "2A1B840", "recv": "2D28F20" } }
```
但它**大部分能力不走封包**，走 NodeIKernel API——那部分**没有版本表可查，QQ 改了就得改代码**。

**SnowLuma**：全部能力都走封包，所以只需要维护这一个偏移表 + `compat/qq.json`（knownBadVersions / minVersion 清单）。QQ 小版本更新通常只改偏移不改协议，改一个数字即可。

> **这是 SnowLuma 架构上最实质的优势**：维护成本曲线平缓。

### 4.3 Action 定义范式对比

**NapCat**（214 个文件，每个一个 class）：
```ts
export const SendMsgPayloadSchema = Type.Object({ group_id: Type.Optional(Type.String()), ... });
export class SendMsg extends OneBotAction<PayloadType, ReturnDataType> {
  actionName = ActionName.SendMsg;
  payloadSchema = SendMsgPayloadSchema;
  async _handle(payload) { ... }
}
// 注册：@ActionHandler(SendMsg) → AutoRegisterRouter.push(target)
```

**SnowLuma**（1 个 `action-kit.ts` + 声明式）：
```ts
export const actions = [
  defineAction({
    name: 'send_custom_face',
    params: {
      emoji_id: f.string().describe('...'),
      group_id: f.groupId().optional().describe('...'),
    },
    returnsSchema: messageResultSchema,
    run: async (p, ctx) => { ... },
  }),
];
```

| 维度 | NapCat class-per-action | SnowLuma defineAction |
|---|---|---|
| 样板代码 | 高（schema 手写 TypeBox + class 骨架） | 低（`f.string()` 自动推导类型 + 校验 + 文档） |
| 类型推导 | `Static<typeof Schema>` | `InferParams`（无需手写 param interface） |
| 文档生成 | 手写 `actionSummary` / `actionDescription` / `examples` | 从 `Field` 自动产出 JSON Schema → catalog → MCP |
| 字段语义 | 无 | `FieldRole`（group_id / user_id / message_id …）供 WebUI 选控件 |
| 校验严格性 | TypeBox Value.Check | 严格 coercer（ADR-0007 明确禁止宽松 union） |
| 可测试性 | 需构造 class 实例 | 纯函数 `run` |

**SnowLuma 的 action-kit 明显更现代**，且直接喂给 SDK / MCP / WebUI 三端。

---

## 5. 能力矩阵（Action 层面）

精确比对（从 `ActionName` 枚举 vs `defineAction({name})` 提取）：

| 项 | 数量 |
|---|---|
| 交集 | 180 |
| 仅 SnowLuma | 36 |
| 仅 NapCat | 23 |
| SnowLuma 总数 | 216 |
| NapCat 总数 | 203 |

### 5.1 仅 NapCat 有（23）

| Action | 说明 | SnowLuma 移植难度 |
|---|---|---|
| `send_packet` | **裸封包发送逃生口** | 低（它本来就发裸包） |
| `ocr_image` | 图片 OCR | 中（有 transformer 可抄） |
| `fetch_ptt_text` | 语音转文字 | 中 |
| `get_rkey` / `nc_get_rkey` | 获取 rkey（媒体 URL 签名） | 低（SnowLuma 已有 `instance-rkey`，只是没暴露 action） |
| `get_robot_uin_range` | 机器人 UIN 范围 | 低 |
| `send_online_file` / `receive_online_file` / `refuse_online_file` / `cancel_online_file` / `get_online_file_msg` | 在线文件传输（5 个） | 中 |
| `send_online_folder` | 在线文件夹 | 中 |
| `get_guild_list` / `get_guild_service_profile` | **QQ 频道** | 高（SnowLuma 无频道协议实现） |
| `send_group_sign` / `set_group_sign` | 群签到 | 低 |
| `upload_images_to_qun_album` | 群相册批量上传 | 低（SnowLuma 已有群相册 CRUD） |
| `set_custom_face_desc` | 收藏表情描述 | 低 |

### 5.2 仅 SnowLuma 有（36，节选）

| Action 组 | 数量 | 价值 |
|---|---|---|
| QQ 空间（feed 详情 / 主页流 / 分享 ark） | 3 | NapCat 有 `qzone` 基础但无 feed 流 |
| 群相册 CRUD（列表等） | 2 | NapCat 只有上传 |
| 群标签 / 群待办 / 群匿名 / 群互动表情 | 8 | NapCat 完全缺失 |
| 收藏表情管理（发送/修改/排序/详情） | 5 | NapCat 只有 1 个 |
| 群文件夹 CRUD（重命名/删除） | 2 | NapCat 只有部分 |
| 闪传文件（重命名/删除） | 2 | NapCat 完全缺失 |
| 群管理员权限细分设置 | 4 | NapCat 只有 `set_group_admin` |
| `request_decrypt_key` | 1 | 数据库解密 |

### 5.3 结论

**功能覆盖上两者高度互补，没有一方碾压另一方。** 交集 180 说明「标准 OneBot 能力」两家都齐；差异集中在「QQ 新功能 / 小众功能」，这些恰恰是最容易随 QQ 更新失效的部分。

---

## 6. 各自独有资产清单

### 6.1 NapCat 独有（SnowLuma 该拿的）

| 资产 | 位置 | 价值 | 移植成本 |
|---|---|---|---|
| **插件系统** | `napcat-onebot/network/plugin*` | ★★★★★ 第三方扩展点，生态基础 | **高**（SnowLuma 需要新增 plugin manager + WebUI 插件页 + 配置 schema 渲染） |
| **插件市场** | `napcat-webui-backend/src/api/PluginStore.ts` | ★★★★ | 中 |
| **二维码登录引导** | `napcat-qrcode` + `webui-backend/api/QQLogin.ts` | ★★★★ | 低（SnowLuma 已有 qrcode 依赖，未做引导流程） |
| **WebUI 终端** | `webui-backend/src/terminal` | ★★★ 运维便利 | 低 |
| **备份/恢复** | `webui-backend/api/BackupConfig.ts` | ★★★ | 中（SnowLuma 有 `webui/backup.ts`，可对照） |
| **频道（guild）** | `action/guild` | ★★★ | 高（要逆向频道协议） |
| **`send_packet` 逃生口** | `action/extends/SendPacket.ts` | ★★★ 排障利器 | 低 |
| **`ocr_image`** | transformer | ★★ | 中 |
| **OpenAPI 生成** | `napcat-schema` | ★★ | 低 |
| **MessageUnique 双向 LRU** | `napcat-common/message-unique.ts` | ★★ 成熟的消息 ID 映射 | 低 |
| **Docker / Installer / 文档站** | 你另外 4 个仓库 | ★★★★ 部署体验 | — |

### 6.2 SnowLuma 独有（NapCat 该拿的）

| 资产 | 位置 | 价值 | 移植成本 |
|---|---|---|---|
| **进程外 hook 架构** | `bridge` | ★★★★★ 版本抗性 + 多账号 + Linux 原生 | **极高**（等于重写 NapCat 接入层） |
| **多账号** | `onebot/manager.ts` + per-uin config | ★★★★★ | 高（NapCat 架构单账号根深蒂固） |
| **消息持久化** | `onebot/message-store.ts`（SQLite + WAL + 迁移 + 索引） | ★★★★ | 中 |
| **历史消息同步** | `history-sync.ts` | ★★★★ | 中 |
| **声明式 action-kit** | `onebot/action-kit.ts` | ★★★★★ 样板代码减半 | 中（要重写 214 个 action，但可渐进） |
| **SDK（npm）** | `sdk` | ★★★★ 开发者入口 | 低 |
| **MCP（npm）** | `mcp` + 597KB catalog | ★★★★ AI 生态入口 | 低（依赖 action catalog） |
| **509 个测试** | 全 package | ★★★★ 重构安全网 | — |
| **零运行时依赖单文件 bundle** | vite + `dlopen` | ★★★ 分发简单 | 中 |
| **TOTP / TLS / 状态 SSE** | `core/src/webui` | ★★★ | 低 |
| **QQ 兼容性 manifest** | `compat/qq.json` | ★★★ 版本事故应急 | 低 |
| **原生 SQLite driver** | `sqlite` | ★★ 免 better-sqlite3 依赖 | 低 |
| **Linux / ARM64 原生支持** | `native/*.so` | ★★★★ | — |

---

## 7. 基座选型分析

### 7.1 若选 SnowLuma 当基座

**要做的事**：把 NapCat 的插件系统、guild、ocr、send_packet、二维码登录、终端搬过来。

| 维度 | 评估 |
|---|---|
| 保留优势 | 进程外 hook、多账号、Linux 原生、现代 action-kit、SDK/MCP、509 测试 |
| 补的短板 | 插件系统（最大工程）、若干小众 action |
| 技术风险 | **中**。SnowLuma 的 `Bridge` → `ApiHub` → `action-kit` 分层清晰，插件系统可以插在 `onebot/instance` 层，不需要动协议层 |
| 工程风险 | **中高**。插件系统要对接 SnowLuma 的 WebUI（React19+Tailwind），不能直接搬 NapCat 的 HeroUI 页面 |
| 长期维护 | **优**。QQ 升级只需改 hook 偏移 |

### 7.2 若选 NapCat 当基座

**要做的事**：把 SnowLuma 的 hook 架构、多账号、消息存储、action-kit 搬过来。

| 维度 | 评估 |
|---|---|
| 保留优势 | 插件系统、社区、文档、部署工具链（你的 4 个仓库） |
| 补的短板 | 进程外 hook（**等于重写核心**）、多账号、消息存储 |
| 技术风险 | **极高**。NapCat 的 214 个 action 全部依赖 `NapCatCore`（NodeIKernel session）。换成封包模型意味着 **214 个 action 全部重写**，且 `napcat-core/apis` 4,836 行的 NodeIKernel 封装全部作废 |
| 工程风险 | 高 |
| 长期维护 | 优（如果能完成） |

### 7.3 推荐

**推荐 SnowLuma 当基座。** 理由按权重排序：

1. **架构演进方向正确**：进程外 hook 是 QQ 生态的必然方向（NapCat 自己也在 `napcat-core/packet` 里做了协议层拦截 的尝试，只是没全面切换）。选它等于选未来。
2. **迁移量不对称**：从 SnowLuma 补插件系统 ≈ 新增 1 个子系统；从 NapCat 换 hook ≈ 重写整个 core + 214 个 action。**前者是 20%，后者是 90%。**
3. **多账号是硬需求**：NapCat 架构上做不了（一个 QQ 进程一个 NapCat）。
4. **代码质量与测试**：509 vs 52 的测试差距，说明 SnowLuma 更适合作为长期演进的底座。
5. **你的部署仓库都指向 Linux**：`NapCatLinuxNodeLoader`、`NapCat-Docker`、`NapCat-Installer` 全是为 Linux 服务端部署。SnowLuma 原生支持 Linux；NapCat 在 Linux 上要靠替换 `核心模块` 这种脆弱手段。

**反方观点（要诚实说）**：如果你**最看重插件生态和现成用户群**，NapCat 是唯一选择——SnowLuma 从零建插件生态需要时间，而 NapCat 已有插件市场和官方白名单。但考虑到**上游已死**，这个生态也不会再增长。

---

## 8. 融合路线图（若选 SnowLuma 基座）

### 阶段 0：可行性验证（1–2 周）

- [ ] 跑通 `SnowLuma-src` 的 `pnpm install && pnpm typecheck && pnpm test`
- [ ] 跑通 `NapCatQQ-src` 的 `pnpm install && pnpm build:shell`
- [ ] 用真实 QQ 验证 SnowLuma 的注入链路（Windows + Linux 各一次）
- [ ] 确认 `native/` 二进制能在当前 QQ 版本工作（`compat/qq.json`）

**Gate**：如果 SnowLuma 的注入在新版 QQ 上已经不通，且原生二进制无法自行编译，整个路线作废。

### 阶段 1：补齐高频缺口（2–4 周）

低风险、高收益的移植：

1. `send_packet`（裸包逃生口）—— SnowLuma 本来就发裸包，几乎零成本
2. `get_rkey` / `nc_get_rkey` —— 已有 `instance-rkey`
3. `ocr_image`、`fetch_ptt_text` —— 抄 transformer 逻辑
4. `send_group_sign` / `set_group_sign`
5. `set_custom_face_desc`、`upload_images_to_qun_album`
6. 二维码登录引导流程
7. `MessageUnique` 双向 LRU 替换 SnowLuma 的 hash 方案（如果更好）

### 阶段 2：插件系统（6–10 周，最大工程）

这是「SnowLuma 变成可扩展平台」的关键。

需要设计（不能照抄 NapCat，因为 UI 栈不同）：

- 插件生命周期：`plugin_init(ctx)` / `plugin_unload()` / `plugin_config_schema()`
- `ctx` 接口：`core`（BridgeInterface）、`onebot`（OneBotInstance）、`actions`（action 注册表）、`router`（Hono 路由）、`logger`、`config`
- 配置 UI：`PluginConfigSchema`（string/number/boolean/select/multi-select/html/text）→ SnowLuma WebUI 动态渲染
- 插件加载：目录扫描 + `package.json` 校验 + 敏感词扫描 + 白名单
- WebUI：插件列表页 / 插件配置页 / 插件市场

**注意**：NapCat 的插件 `ctx.core` 是 `NapCatCore`（NodeIKernel），SnowLuma 的是 `BridgeInterface`（封包）——**插件 API 语义要重新定义**，不能 1:1 移植。

### 阶段 3：WebUI 运维能力（3–5 周）

- 进程管理页（SnowLuma 已有 `HookProcessInfo`，缺 UI）
- 终端
- 备份 / 恢复
- 插件页（依赖阶段 2）

### 阶段 4：长尾能力（按需）

- 频道（guild）—— 需要逆向频道协议，成本最高，收益最低，建议最后做或不做
- 在线文件传输
- 群管理员权限细分

### 阶段 5：分发

- 把 `NapCat-Docker` / `NapCat-Installer` / `NapCatLinuxNodeLoader` 改造成支持新项目
- 注意：这些仓库也是 NapCat 品牌，需要重命名或新建

---

## 9. 风险清单

| 风险 | 等级 | 说明 | 缓解 |
|---|---|---|---|
| **上游已死** | 🔴 极高 | 两个项目都停止维护。QQ 每次更新都可能破坏 hook 偏移，**没人会帮你修** | 自己维护 `compat/qq.json` + 偏移表；加入社区（`SnowLuma-QQ` 群 / Tg 频道仍存在） |
| **原生二进制均为闭源预编译** | 🔴 极高 | **两个仓库都没有原生层源码**：SnowLuma 0 个 `.c/.cpp/.rs`（`AGENTS.md` 明说 `packages/runtime/native` 是「supplied build inputs」）；NapCat 也只有 1 个测试用 `probe.cpp`，`MoeHoo.*.node`、`napi2native.*.node`、`NapCatWinBootHook.dll` 全是预编译产物。QQ 更新导致失效时，**两边都无法自行修复** | 只能在 QQ 版本上「挑着用」；把 `compat/qq.json` 的 knownBadVersions 当运维手段 |
| **许可限制** | 🟠 高 | SnowLuma 禁商用、禁公开发布修改版；NapCat 禁修改分发 | 仅自用；公开需书面授权 |
| **插件 API 语义不兼容** | 🟡 中 | NapCat 插件依赖 NodeIKernel 语义 | 重新设计 SnowLuma 插件 API |
| **WebUI 重写成本** | 🟡 中 | 两套 UI 栈完全不同 | 只搬功能设计，不搬代码 |
| **QQ 协议逆向** | 🟡 中 | 频道等能力需要逆向 | 优先级降到最低 |
| **Node 24 硬要求** | 🟢 低 | SnowLuma 要求 Node 24.22.1+ | 发行包内置 node.exe，无影响 |

> **关于「原生二进制无法重建」**：这是整个融合计划的最大不确定性，且**两个项目同样中招**。SnowLuma 的 `packages/runtime/native/` 只有预编译产物，`AGENTS.md` 明确写着它们是「supplied build inputs」；NapCat 的 `napcat-native/` 也只有 `.node` 二进制（`MoeHoo.*` 协议层拦截、`napi2native.*` 注入、`NapCatWinBootHook.dll`），仓库里唯一的 C++ 是 `.github/tests/windows-loader/probe.cpp`（测试用）。两边的原生层都**没有公开源码**。做阶段 0 验证时必须重点确认：现有二进制能否在你当前的 QQ 版本上工作。这是整个计划的**唯一硬门禁**。

---

## 10. 附：关键代码位置索引

### NapCat

| 关注点 | 路径 |
|---|---|
| 注入入口 | `packages/napcat-shell-loader/launcher.bat`、`loadNapCat.js`、`qqnt.json` |
| 协议层拦截 | `packages/napcat-core/packet/handler/client.ts`（MoeHoo）、`external/napi2native.json`（偏移表） |
| API 层 | `packages/napcat-core/apis/*.ts`（13 个类，4,836 行） |
| Action 基类 | `packages/napcat-onebot/action/OneBotAction.ts` |
| Action 注册 | `packages/napcat-onebot/action/auto-register.ts`、`router.ts`（ActionName 枚举） |
| 插件系统 | `packages/napcat-onebot/network/plugin/`（types.ts 是 API 全貌） |
| 插件加载 | `packages/napcat-onebot/network/plugin/loader.ts` |
| 网络适配 | `packages/napcat-onebot/network/*.ts` |
| WebUI 后端 | `packages/napcat-webui-backend/src/api/*.ts` |
| 消息 ID 映射 | `packages/napcat-common/src/message-unique.ts` |
| 构建配置 | `packages/napcat-shell/vite.config.ts` |

### SnowLuma

| 关注点 | 路径 |
|---|---|
| 注入 | `packages/bridge/src/injector.ts`、`hook-manager.ts`、`pipe-watcher.ts` |
| 管道协议 | `packages/bridge/src/qq-hook-client.ts`（`PipeOp`、`PipeFrame`） |
| 账号识别 | `packages/bridge/src/qq-account/`（登录库、进程、文件变化） |
| 协议实现 | `packages/protocol/src/oidb-services/`（117 文件）、`msg-push/`、`highway/` |
| Bridge 核心 | `packages/core/src/bridge/bridge.ts`（`Bridge`、`ApiHub`） |
| API 层 | `packages/core/src/bridge/apis/*.ts`（19 个区域） |
| Action DSL | `packages/onebot/src/action-kit.ts` |
| Action 定义 | `packages/onebot/src/actions/*.ts` |
| 多账号 | `packages/onebot/src/manager.ts`、`instance.ts` |
| 消息存储 | `packages/onebot/src/message-store.ts`、`history-sync.ts` |
| 网络适配 | `packages/onebot/src/network/` |
| WebUI 后端 | `packages/core/src/webui/`（30 文件，Hono） |
| SDK | `packages/sdk/src/` |
| MCP | `packages/mcp/src/` + `generated/catalog.json` |
| 兼容性 | `compat/qq.json`、`compat/qq.schema.json` |
| 设计决策 | `RoadMap.md`、`AGENTS.md`、`CLAUDE.md`（含 ADR 引用） |

---

## 11. 一句话总结

> **SnowLuma 是架构更先进但生态空白的「未来」，NapCat 是生态完善但架构陈旧的「过去」。两者都已停止维护，且两边的原生层都没有公开源码，融合的唯一现实价值是「自己维护一个够用的协议端」，而不是做一个新开源项目。若要做，选 SnowLuma 当基座，第一阶段只补 action 缺口和插件系统，不要碰频道。开工前必须先验证：手上的预编译原生二进制能否在你当前的 QQ 版本上跑通——这是整个计划的硬门禁。**
