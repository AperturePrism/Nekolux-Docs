# 快速开始

> 从零到「QQ 已登录、OneBot 接口可用」，大约 20 分钟。
>
> 如果你只想先跑起来看看，跟着本文做即可。详细的平台差异、排错、进阶配置在
> [Windows 部署](/guide/DEPLOY-WINDOWS) 和 [Linux 部署](/guide/DEPLOY-LINUX)。

---

## 零、先确认你要哪种部署

Nekolux 的运行时是一个 Node 程序，它通过 **ptrace 注入**把 hook 模块装进正在运行的 QQ。
所以有两种跑法：

| 方式 | 适合 | 特点 |
|---|---|---|
| **Docker**（推荐） | Linux 服务器 / NAS / 长期运行 | 镜像内自带 Xvfb + VNC + QQ，一条命令起；宿主机不用装 Qt/GTK 依赖 |
| **裸机** | Windows 桌面 / 想用本地已装的 QQ | 直接注入你本机的 QQ 进程；Windows 无需 X11，Linux 需要 X 环境 |

下面两条路都走一遍。**Docker 是通用方案**，Windows 上也能用（装 Docker Desktop）。

---

## 一、准备

### 1.1 通用要求

- 一个 **QQ 账号**（建议小号先试；登录方式与官方客户端一致）
- 能访问 QQ 服务器的网络
- 约 **2GB** 可用内存、**5GB** 磁盘

### 1.2 Docker 方式额外要求

- Docker 20.10+
- **必须**能加 `--cap-add SYS_PTRACE`（ptrace 注入需要）

### 1.3 裸机方式额外要求

| 平台 | 需要 |
|---|---|
| Windows | 已安装 QQ NT（9.9.x），**以管理员身份**运行 Nekolux（ptrace 等价权限） |
| Linux | 已安装 QQ NT（3.2.x）、X 环境（桌面或 Xvfb）、`kernel.yama.ptrace_scope=0` |

---

## 二、拿到运行时

有两种来源，任选其一：

### 2.1 用发行包（最快）

从 [Releases](https://gitea.binbim.top/AperturePrism/Nekolux/releases) 下载对应平台的压缩包，
解压得到 `nekolux-dist/`，里面有：

```
nekolux-dist/
├── index.mjs          # 运行时入口
├── client/            # WebUI 前端
├── native/            # 原生模块（hook / sqlite / ffmpeg）
├── package.json
└── release.json
```

### 2.2 从源码构建

需要 **Node 24.22.1+** 和 **pnpm 11.25.0**：

```bash
git clone https://gitea.binbim.top/AperturePrism/Nekolux.git
cd Nekolux
pnpm install

# ⚠ 必须在仓库根目录跑，不要用 --filter 只构建单个包
pnpm build:all
```

产物在 `dist/`。

> **常见坑**：只跑 `pnpm --filter @nekolux/core build:all` 不会产出 `dist/client/`，
> 启动后 WebUI 会报 `client bundle not found`。必须用根级的 `pnpm build:all`。

> **跨平台注意**：构建只复制**构建机平台**的原生模块。给 Linux 部署时，
> 把 `native/nekolux-linux-x64.node` 与 `.so`、`native/sqlite/prebuilds/linux-x64/`
> 补齐；Windows 则要 `nekolux-win32-x64.node/.dll`。

---

## 三、Docker 部署（通用）

### 3.1 准备 build-context

Dockerfile 在 `docker/` 目录，它期望同级有一个 `build-context/`：

```bash
cd Nekolux

export NEKOLUX_DIST=$PWD/dist          # 或你解压的 nekolux-dist
mkdir -p docker/build-context/plugins
cp -r "$NEKOLUX_DIST" docker/build-context/nekolux
cp packages/runtime/dist/unified-bootstrap.mjs docker/build-context/
cp -r examples/plugins/*/ docker/build-context/plugins/   # 示例插件（可选）

cd docker && docker build -t nekolux:local .
```

### 3.2 起容器

```bash
docker run -d --name nekolux \
  --restart unless-stopped \
  --cap-add SYS_PTRACE \
  --security-opt seccomp=unconfined \
  --shm-size 1gb \
  -e VNC_PASSWORD='换成你自己的密码' \
  -e NEKOLUX_LOG_LEVEL=debug \
  -e UNIFIED_PLUGIN_ALLOW=keyword-reply \
  -p 5099:5099 \
  -p 5902:5900 \
  -p 3000:3000 \
  -p 3001:3001 \
  -v "$PWD/data:/app/data" \
  nekolux:local
```

| 端口 | 用途 |
|---|---|
| 5099 | WebUI 控制台 |
| 5902 | VNC（连进去操作 QQ 登录） |
| 3000 | OneBot HTTP |
| 3001 | OneBot WebSocket |

### 3.3 登录 QQ

1. 用 VNC 客户端连 `<宿主机IP>:5902`，密码是上面 `VNC_PASSWORD`
2. 看到 QQ 登录界面，扫码或密码登录
3. 登录成功后容器日志会出现 `session started: UIN=xxx`

### 3.4 验证

浏览器打开 `http://<宿主机IP>:5099`，用容器启动日志里打印的 WebUI token 登录。
或者直接调接口：

```bash
curl -X POST http://<宿主机IP>:3000/ \
  -H 'Content-Type: application/json' \
  -d '{"action":"get_login_info","params":{}}'
```

返回 `{"status":"ok","data":{"user_id":你的QQ号,...}}` 就成功了。

---

## 四、裸机部署

### 4.1 Windows

**前置**：已装 QQ NT（`C:\Program Files\Tencent\QQNT\versions\9.9.x`）。

1. **以管理员身份**打开 PowerShell（ptrace 需要）
2. 启动 QQ 并登录（保持运行）
3. 启动 Nekolux：

```powershell
cd nekolux-dist
$env:NEKOLUX_LOG_LEVEL = "debug"
node index.mjs
```

4. 浏览器打开 `http://127.0.0.1:5099`，日志里有 token
5. 进「进程注入」页，找到 QQ 进程，点「加载」

> Windows 不需要 X11/VNC，因为 QQ 是本地桌面程序。

### 4.2 Linux

**前置**：已装 QQ NT（3.2.x）、有 X 环境。

```bash
# 1. 允许 ptrace（关键！否则注入会静默失败）
sudo sysctl -w kernel.yama.ptrace_scope=0
echo 'kernel.yama.ptrace_scope=0' | sudo tee -a /etc/sysctl.conf

# 2. 无桌面环境时起 Xvfb
sudo apt install -y xvfb
Xvfb :99 -screen 0 1024x768x24 &
export DISPLAY=:99

# 3. 启动 QQ（不要用官方启动器，直接跑二进制）
cd /opt/QQ && ./qq --no-sandbox &

# 4. 启动 Nekolux
cd nekolux-dist
NEKOLUX_LOG_LEVEL=debug node index.mjs
```

5. 浏览器打开 `http://127.0.0.1:5099` → 「进程注入」→ 加载 QQ 进程

> **ptrace_scope 是 Linux 最常见的坑**：不设成 0 时注入会失败但日志只写
> `awaiting login`，看起来像「QQ 没登录」，实际是权限问题。

---

## 五、接上你的机器人框架

Nekolux 对外是标准 OneBot v11。在 WebUI「节点配置」里加一个网络适配器：

| 类型 | 配置 |
|---|---|
| HTTP 服务端 | 端口 3000，给你的框架填 `http://<host>:3000` |
| WS 服务端 | 端口 3001，框架连 `ws://<host>:3001` |
| HTTP 客户端（反向） | 填你的框架地址，Nekolux 主动上报 |

AstrBot / NoneBot / Koishi 等直接按 OneBot v11 接入即可。

---

## 六、装插件

官方插件源**已内置**，打开 WebUI →「插件市场」就能看到：

- `keyword-reply` 关键词自动回复
- `packet-observer` 封包观察（演示原始封包 API）
- `webui-demo` WebUI 扩展演示

安装后需要在「插件」页确认状态，并在容器/启动配置里把插件 ID 加进白名单
（`UNIFIED_PLUGIN_ALLOW=插件ID1,插件ID2`）后重启。

想写自己的插件？看 [插件系统](/plugins/PLUGIN-SYSTEM)。

---

## 七、下一步

| 我想… | 去哪 |
|---|---|
| 看 Windows 详细部署与排错 | [Windows 部署](/guide/DEPLOY-WINDOWS) |
| 看 Linux 详细部署与排错 | [Linux 部署](/guide/DEPLOY-LINUX) |
| 写插件 | [插件系统](/plugins/PLUGIN-SYSTEM) |
| 部署到 NAS | [NAS 部署](/guide/NAS-DEPLOYMENT) |
| 多账号 | [多账号](/guide/MULTI-ACCOUNT) |
| 了解架构 | [运行时装配](/guide/RUNTIME-ASSEMBLY) |
