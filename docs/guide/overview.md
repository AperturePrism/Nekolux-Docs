<div align="center">

# Nekolux

*Neko（猫）× lux（光）*

**SnowLuma 之路的接续者 —— 进程外 hook × NapCat 式可扩展性的融合体**

*上游在，学上游；上游没了，自己扛。*

[![License](https://img.shields.io/badge/License-PolyForm_NC_1.0.0-orange)](https://github.com/AperturePrism/Nekolux/blob/main/LICENSE.md)
[![OneBot](https://img.shields.io/badge/OneBot-v11-black)](https://github.com/botuniverse/onebot-11)
[![QQ](https://img.shields.io/badge/QQ-Win_9.9.36·Linux_3.2.28-12B7F5?logo=tencentqq&logoColor=white)](https://im.qq.com)
[![Tests](https://img.shields.io/badge/tests-125_passing-brightgreen)](#-实测与验证)
[![Platform](https://img.shields.io/badge/platform-Windows·Linux·Docker-blue)](#-快速开始)

*自维护的 QQ 协议端：官方客户端零改动，插件、部署、偏移维护全套自研*

</div>

---

## 📖 背景：为什么有这个项目

| 上游 | 现状 |
|---|---|
| `NapNeko/NapCatQQ` | 2026-11-12 删光源码，只剩「Ending」README |
| `SnowLuma/SnowLuma` | 404 |

两个先行者铺下的路，自此无人接续。**Nekolux 不是复刻，是接棒**：
以 SnowLuma 的进程外 hook 为基座，把 NapCat 十倍于人的可扩展性（插件系统）
和成熟的部署经验移植过来，偏移维护换成可持续的签名扫描 —— 全部自己扛。

## ✨ 核心特性

| | 特性 | 说明 |
|---|---|---|
| 🔌 | **QQ 本体零改动** | ptrace manual-map 进程外注入，不碰 QQ 的 package.json、不替换任何文件，QQ 崩了不带走 QQ |
| 🛡️ | **签名扫描偏移** | 不用死版偏移表 —— 通配符签名扫描 + 函数入口校验 + 静态表交叉验证，QQ 升级重新扫一遍即可（`pnpm resolve-offsets`） |
| 🧩 | **完整插件系统** | Worker 沙箱 / 插件市场（sha256 校验）/ 热重载 / 配置 schema 自动生成 UI / `ctx.callAction` 调用全部内置 action |
| 🔐 | **内置 action 保护** | 插件不能覆盖 `send_group_msg` 等内置 action，注册即拒绝 |
| 👥 | **多账号架构** | 每 QQ 进程独立注入会话 / 独立配置 / 独立端口 / 独立存储，插件按 `self_id` 路由 |
| 📦 | **Docker 一键部署** | 基于 napcat-docker 镜像，VNC 扫码登录，可与现有部署并存 |
| 🖥️ | **WebUI + MCP** | React WebUI（插件管理 / 插件市场页内建）+ MCP 工具暴露 |
| ✅ | **实测文化** | 125 个单元测试 + NAS 压力 / 边界 / e2e 全套实测报告，全部随仓库公开 |

## 🆚 融合路线：两条路都走过了，选哪条、为什么

社区里有两条融合路线。**SnowCat 系走「进程内」**：NapCat 底座 + winmm/V8
通道注入 QQ 主进程；**Nekolux 走「进程外」**：SnowLuma 底座 + ptrace 注入。
两条路都合法可行，取舍不同：

| | **进程内**（NapCat / SnowCat 路线） | **进程外**（Nekolux 路线） |
|---|---|---|
| 注入方式 | V8 通道 / package.json main 重定向 | ptrace manual-map，QQ 与机器人是两个进程 |
| QQ 崩溃影响 | 机器人一起挂 | 机器人还在，可自动重注入 |
| 多账号 | 一进程一账号 | ✅ 架构级支持（每 PID 独立会话） |
| 插件生态起点 | 直接继承 NapCat 插件 | 重新设计（沙箱 + 市场 + 热重载） |
| Linux | 需替换 wrapper.node | ✅ 原生 ptrace，不改任何文件 |
| 协议层 | 调 QQ 内部 API（跟版本走） | 自实现 OIDB/SSO 封包（只需函数地址） |
| 部署形态 | 便携目录 / V8 通道 | ✅ Docker 镜像一键跑 |

**一句话**：进程内贴着 QQ 的心脏走，省一层 IPC；进程外隔着护栏走，
QQ 崩了不陪葬、多账号天生就有、部署可以装进容器。Nekolux 选了后者，
并把前者的长处（插件系统设计、部署经验、偏移方法论）移植了过来。

### 基座之上，我们补了什么

| 能力 | SnowLuma | NapCat | Nekolux |
|---|---|---|---|
| 进程外注入 / 多账号 | ✅ | ❌ | ✅（继承） |
| 完整插件系统 | ❌ | ✅ | ✅ **自研**（沙箱 / 市场 / 热重载 / 配置 UI） |
| 偏移获取 | 内置闭源产物 | 硬编码偏移表 | ✅ **签名扫描**（实测 RVA 与 NapCat 静态表精确一致） |
| Docker 部署 | ❌ | ✅ | ✅（VNC 登录 / ptrace_scope 自检文档） |
| 跨版本抗性 | 强 | 弱 | 强（签名可重扫） |

## 🚀 快速开始

### Docker（推荐）

```bash
# 0️⃣ 宿主机一次（兄弟进程 ptrace 需要；缺失时注入静默失败，只报 awaiting login）
sysctl -w kernel.yama.ptrace_scope=0

# 1️⃣ 组装镜像（NEKOLUX_DIST = 运行时构建产物目录）
cd docker && NEKOLUX_DIST=/path/to/nekolux-dist bash build.sh

# 2️⃣ 启动
docker run -d --name nekolux \
  --cap-add SYS_PTRACE --security-opt seccomp=unconfined --shm-size 1gb \
  -e VNC_PASSWORD=<密码> -e UNIFIED_PLUGIN_ALLOW=demo-plugin,keyword-reply \
  -p 5099:5099 -p 5902:5900 -p 3100:3000 -p 3101:3001 \
  -v ./data:/app/data -v ./config:/app/nekolux/config \
  nekolux:local

# 3️⃣ VNC 连 :5902 扫码 → OneBot 起在 :3000 (HTTP) / :3001 (WS)，WebUI 在 :5099
```

详见 [`docker/README.md`](https://github.com/AperturePrism/Nekolux/tree/main/docker)。

### 源码开发

```bash
# 工具链：Node 24.22.1+ / pnpm 11.25.0
pnpm install
pnpm test          # 125 个单元测试，无 QQ 环境可跑

pnpm resolve-offsets <wrapper.node>   # 签名扫描偏移
```

## 🧩 插件

```js
// plugins/my-plugin/index.js
export function plugin_init(ctx) {
    // 注册自定义 action（内置名会被拒绝）
    ctx.actions.register('my_hello', (params) => ({ hi: params.name }));

    // 收到消息 → 调用 214+ 内置 action 回复
    ctx.onmessage = async (event) => {
        await ctx.callAction('send_group_msg', {
            group_id: event.group_id,
            message: [{ type: 'text', data: { text: '收到～' } }],
        });
    };
}
```

- **白名单加载**：默认全拒，显式放行（安全边界不靠自觉）
- **沙箱**：插件可跑在 Worker 线程，双向 RPC，主进程不被插件拖死
- **配置 UI**：`plugin_config_schema` 声明字段，WebUI 自动生成表单
- **热重载**：绕过 ESM 缓存，改完即刷
- **市场**：本地列表 + 远端索引一键安装（sha256 校验 / 大小限制 / 失败清理）

示例插件：[`examples/plugins/keyword-reply/`](https://github.com/AperturePrism/Nekolux/tree/main/examples/plugins/keyword-reply)（关键词自动回复）
· 完整文档：[`docs/PLUGIN-SYSTEM.md`](/plugins/PLUGIN-SYSTEM)

## 🗂️ 仓库结构

```
Nekolux
├── 📦 packages/
│   ├── runtime/            运行时装配（bootstrap：自动注入 QQ + 装配插件）
│   ├── plugin/             插件系统（沙箱 / 市场 / 热重载 / 配置 / 路由）
│   └── native-offsets/     签名扫描式偏移解析（PE/ELF，替代硬编码偏移表）
├── 🛠️ tools/
│   ├── resolve-offsets.ts  偏移解析 CLI
│   ├── reversing/          离线逆向工具（Python / C / bash）
│   ├── verify/             阶段 0 / 注入 / 握手验证脚本
│   ├── onebot-tests/       压力 / 边界 / 插件 e2e 驱动
│   └── nas/                NAS 远程部署脚本（凭据走环境变量）
├── 🐳 docker/              Dockerfile + entrypoint + build.sh
├── 🧪 examples/plugins/    示例插件
└── 📖 docs/                设计文档 + 全部实测报告（见下）
```

## ⚙️ 运行时栈

```
Docker 容器（或裸机）
├── QQ（官方原版，一字节未动）
│    └── Electron × Node（Xvfb :99 显示，VNC :5900 扫码）
└── Nekolux runtime（独立进程，Node 24）
     ├── ptrace manual-map 注入 → memfd 常驻模块
     ├── mojo 命名管道（QHP1 协议，进程间通信）
     ├── OneBot v11（HTTP :3000 / WS :3001，214+ action）
     ├── 插件系统（Worker 沙箱 / 市场 / 热重载）
     ├── WebUI :5099（React，插件管理页 + 插件市场页内建）
     └── MCP（全部动作自动暴露为工具）
```

## 📊 实测与验证

每一项能力都有实测报告随仓库公开，这是本项目和「README 机器人」的区别：

| 验证项 | 结果 | 报告 |
|---|---|---|
| Windows 阶段 0（注入 / 管道 / QHP1 握手） | ✅ | [docs/reports/PHASE0-VERIFICATION.md](/reports/PHASE0-VERIFICATION) |
| Linux 阶段 0（WSL2 + VPS 实机） | ✅ | [docs/reports/PHASE0-LINUX-VERIFICATION.md](/reports/PHASE0-LINUX-VERIFICATION) |
| 签名扫描 vs NapCat 静态偏移表 | ✅ RVA 精确一致 | [docs/OFFSET-MAINTENANCE.md](/protocol/OFFSET-MAINTENANCE) |
| NAS Docker 双 QQ 并存注入 | ✅ | [docs/NAS-DEPLOYMENT.md](/guide/NAS-DEPLOYMENT) |
| 压力（并发 20）/ 边界（撤回 / 戳一戳 / 长图）/ 插件 e2e | ✅ | [docs/NAS-TEST-REPORT.md](/guide/NAS-TEST-REPORT) |
| 多账号（双 QQ 同时注入、独立端口） | ✅ 架构验证 | [docs/MULTI-ACCOUNT.md](/guide/MULTI-ACCOUNT) |
| 单元测试 | ✅ 125 passing | `pnpm test` |

### 平台支持

| 平台 | 封包 hook（签名） | OneBot 主路径 |
|---|---|---|
| Windows QQ 9.9.36 | ✅ send/recv 唯一命中 | ✅ |
| Linux QQ 3.2.28 | —（镜像内置） | ✅（NAS 实测） |
| Linux QQ 3.2.35+ | ❌ 网络层移入主程序 libuv | ✅（VPS 实测） |

> Linux 3.2.35 的结论：QQ 把网络层搬进了主程序的 libuv，`wrapper.node` 只剩
> 协议编解码 —— 封包 hook 在该版本结构性失效，但 OneBot 主路径（消息、WebUI、登录）
> 完全可用。详见 [docs/LINUX-HOOK-INVESTIGATION.md](/protocol/LINUX-HOOK-INVESTIGATION)。

## 📚 文档

| 文档 | 内容 |
|---|---|
| 🏗️ [MERGE-PLAN](/guide/MERGE-PLAN) | 合并方案：为什么选进程外做基座 |
| 🧩 [PLUGIN-SYSTEM](/plugins/PLUGIN-SYSTEM) | 插件系统全文档（16 节：契约 / 沙箱 / 市场 / 热重载） |
| 🔬 [OFFSET-MAINTENANCE](/protocol/OFFSET-MAINTENANCE) | 签名采集 → 交叉验证 → 落地全流程 |
| 🐧 [LINUX-HOOK-INVESTIGATION](/protocol/LINUX-HOOK-INVESTIGATION) | Linux 3.2.35 网络层迁移调查 |
| 🐳 [docker/README](https://github.com/AperturePrism/Nekolux/tree/main/docker) | 部署 / 登录 / 端口 / ptrace_scope 排坑 |
| 📊 [RUNTIME-ASSEMBLY](/guide/RUNTIME-ASSEMBLY) | bootstrap 装配层设计 |
| 👥 [MULTI-ACCOUNT](/guide/MULTI-ACCOUNT) | 多账号架构 + 双容器方案 |
| 📜 [reports/](/reports/X64-CODEC-ALIVE-EXPERIMENT) | 架构分析 + 两轮阶段 0 验证原始报告 |

## 🔐 授权说明

> **License：PolyForm Noncommercial 1.0.0（详见 [LICENSE.md](https://github.com/AperturePrism/Nekolux/blob/main/LICENSE.md)）**

授权分两部分，边界说清楚：

**仓库原创部分（开放，非商业）**
- `packages/`、`docker/`、`tools/`、`docs/`、`examples/` 全部为本项目独立实现，
  不含 SnowLuma / NapCat 源码，依 PolyForm NC 1.0.0 开放：
  任何**非商业**用途可自由使用 / 修改 / 分发，商用需联系作者。

**运行时部分（不在本仓库，不可公开分发）**
- 完整运行依赖 SnowLuma 的进程外 hook 运行时（修改版）。SnowLuma 原许可
  禁止公开发布修改版 —— 因此运行时**不在本仓库内、不随本仓库分发**，
  使用者需自行获取并承担合规责任。

一句话：**仓库的归仓库，白盒可查；运行时的归运行时，各守其界。**

## 🙏 致谢

- **SnowLuma** —— 进程外 hook 基座。路是他们修的，我们现在接着修
- **NapCat** —— 插件系统设计、偏移表格式、OneBot 实现的参考范本
- **LLQQNT** —— 「签名 vs 硬编码偏移」方法论的启发（`OFFSET-RESOLUTION.md`）
- **OneBot 11** —— action 与事件的标准接口
- **QQ（腾讯）** —— 本项目仅供个人学习研究，与腾讯无任何关联；账号风控风险自负

## ⚠️ 已知风险

| 风险 | 等级 | 说明 |
|---|---|---|
| **上游已死** | 🔴 | QQ 更新后无人修，全部靠自己（签名扫描是为了让「自己扛」成本更低） |
| **闭源 native** | 🔴 | hook 的 .so/.node 是预编译产物，失效时需重新逆向 |
| **运行时不可分发** | 🟠 | 受 SnowLuma 原许可约束，见上文授权说明 |
| **Linux 封包 hook** | 🟢→🟡 | 运行时自身的裸包收发**不缺**——闭源 addon 经 QHP1 双向覆盖（`send_packet` action 已上线，NAS 实测）；x64 codec 层存活与四组签名（[决定性实验](/reports/X64-CODEC-ALIVE-EXPERIMENT)）服务于 NapCat 兼容与独立诊断通道（`native/packet-hook/`，零账号验证过的保险工具） |
| **9.9.37 listener 改名** | 🟡 | 6 个内核事件回调在 9.9.37/3.2.35 改名，旧名 hook 会**静默丢失事件**；注入后必须做事件流自检，不能以"无报错"当作成功 |
| **签名单版本实测** | 🟡 | 跨版本稳定性未验证 |
