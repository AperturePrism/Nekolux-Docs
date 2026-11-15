# Linux 部署（保姆级）

> 适用：Debian / Ubuntu / Arch 等主流发行版，已装或准备装 QQ NT（3.2.x）
> 目标：从零到「QQ 已注入、OneBot 接口可用」
> 预计 25 分钟

---

## 一、先选部署方式

Linux 上强烈建议 **Docker**。原因：QQ NT 依赖一大堆 Qt/GTK/X11 库，裸机部署要手工装几十个包；
Docker 镜像里已经配好了 Xvfb + VNC + QQ，一条命令起。

| 方式 | 适合 |
|---|---|
| **Docker**（推荐） | 服务器 / NAS / 长期运行 |
| 裸机 | 已有桌面环境，或想复用系统里已装的 QQ |

---

## 二、Docker 部署（推荐）

### 2.1 安装 Docker

```bash
# Debian / Ubuntu
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker          # 或者重新登录
```

验证：

```bash
docker --version
```

### 2.2 检查 ptrace 权限（**最关键的一步**）

Nekolux 用 ptrace 注入 QQ 进程。Linux 默认限制非 root 进程 ptrace 兄弟进程：

```bash
sysctl kernel.yama.ptrace_scope
```

如果是 `1`，**必须改成 0**：

```bash
sudo sysctl -w kernel.yama.ptrace_scope=0

# 永久生效
echo 'kernel.yama.ptrace_scope=0' | sudo tee -a /etc/sysctl.conf
```

> **这是 Linux 上最常见的坑**：不改的话注入会失败，但日志只写 `awaiting login`，
> 看起来像「QQ 没登录」，实际上是权限问题，非常难排查。

### 2.3 准备运行时

**方式 A：下载发行包**

```bash
mkdir -p ~/nekolux && cd ~/nekolux
wget https://github.com/AperturePrism/Nekolux/releases/download/v<版本>/nekolux-<版本>-linux-x64.tar.gz
tar xzf nekolux-<版本>-linux-x64.tar.gz
# 得到 nekolux-dist/
```

**方式 B：从源码构建**

```bash
git clone https://github.com/AperturePrism/Nekolux.git
cd Nekolux
pnpm install

# 必须在仓库根目录跑
pnpm build:all
# 产物在 dist/
```

> **跨平台坑**：在 Windows/Mac 上构建的 `dist/` **不含 Linux 原生模块**。
> 必须在 Linux 上构建，或者手动补齐：
> - `native/nekolux-linux-x64.node`
> - `native/nekolux-linux-x64.so`
> - `native/sqlite/prebuilds/linux-x64/`
> - `native/websocket-linux-x64.node`

检查：

```bash
ls nekolux-dist/native/ | grep linux
```

应该有上面几个文件。

### 2.4 构建镜像

```bash
cd Nekolux

export NEKOLUX_DIST=$PWD/dist     # 或 ~/nekolux/nekolux-dist
mkdir -p docker/build-context/plugins
cp -r "$NEKOLUX_DIST" docker/build-context/nekolux
cp packages/runtime/dist/unified-bootstrap.mjs docker/build-context/
cp -r examples/plugins/*/ docker/build-context/plugins/

cd docker
docker build -t nekolux:local .
```

构建约 1-3 分钟（取决于磁盘）。

### 2.5 起容器

```bash
mkdir -p ~/nekolux/data

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
  -v ~/nekolux/data:/app/data \
  nekolux:local
```

**三个参数不能省**：

| 参数 | 为什么 |
|---|---|
| `--cap-add SYS_PTRACE` | 注入需要 ptrace 能力 |
| `--security-opt seccomp=unconfined` | 默认 seccomp 策略会拦 ptrace |
| `--shm-size 1gb` | QQ 是 Electron 应用，默认 64MB /dev/shm 会崩 |

### 2.6 检查容器状态

```bash
docker ps --filter name=nekolux
docker logs -f nekolux
```

正常启动的日志：

```
=== unified container starting ===
[1/4] Xvfb ready
[2/4] openbox ready
[3/4] VNC on :5900 (password set)
[4/4] QQ launched (pid 29)
=== launching Nekolux ===
[WebUI] listening http://0.0.0.0:5099
[Hook] awaiting login: PID=29
```

### 2.7 登录 QQ

1. 用 VNC 客户端连 `<服务器IP>:5902`，密码是 `VNC_PASSWORD`
2. 看到 QQ 登录界面
3. 扫码或密码登录
4. 登录成功后日志变成：

```
[Hook] pipe connected: PID=29
[Bridge] session started: UIN=你的QQ号
[OneBot] session started: UIN=你的QQ号
[OneBot.HTTP] listening 0.0.0.0:3000/
```

### 2.8 验证

```bash
curl -X POST http://127.0.0.1:3000/ \
  -H 'Content-Type: application/json' \
  -d '{"action":"get_login_info","params":{}}'
```

返回：

```json
{"status":"ok","retcode":0,"data":{"user_id":123456,"nickname":"你的昵称"}}
```

成功。

---

## 三、裸机部署

### 3.1 安装系统依赖

**Debian / Ubuntu**：

```bash
sudo apt update
sudo apt install -y \
  libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6 \
  xdg-utils libatspi2.0-0 libsecret-1-0 libgbm1 \
  libasound2 xvfb
```

**Arch**：

```bash
sudo pacman -S --needed gtk3 nss alsa-lib at-spi2-core \
  libxcomposite libxdamage libxrandr libxkbcommon xvfb
```

### 3.2 安装 QQ NT

从 AUR 或官方 deb 包安装。手动解包也可以：

```bash
wget -O qq.deb "https://qqdl.gtimg.cn/qqfile/QQNT/9.9.37/beta/816b3c79/linuxqq_3.2.35-54395_amd64.deb"
dpkg-deb -x qq.deb /opt/qqroot
# QQ 在 /opt/qqroot/opt/QQ/
```

### 3.3 设置 ptrace

```bash
sudo sysctl -w kernel.yama.ptrace_scope=0
echo 'kernel.yama.ptrace_scope=0' | sudo tee -a /etc/sysctl.conf
```

### 3.4 准备 X 环境

有桌面就跳过。无桌面（服务器）：

```bash
# 清掉可能的残留锁
sudo rm -f /tmp/.X99-lock

Xvfb :99 -screen 0 1024x768x24 &
export DISPLAY=:99
```

> **坑**：Xvfb 没起来就启动 QQ 会报 `Missing X server` 直接退出。
> 用 `xdpyinfo -display :99` 确认可用再往下走。

### 3.5 启动 QQ

```bash
cd /opt/qqroot/opt/QQ
./qq --no-sandbox &
```

等 10 秒左右，QQ 窗口出现在 Xvfb 里（用 VNC 或截图工具查看）。

### 3.6 启动 Nekolux

```bash
cd ~/nekolux/nekolux-dist
export DISPLAY=:99
NEKOLUX_LOG_LEVEL=debug node index.mjs
```

### 3.7 注入并验证

同 Docker 方式的第 7、8 步：WebUI `http://<host>:5099` → 「进程注入」→ 加载 QQ 进程。

---

## 四、常见问题

### 4.1 注入后一直 `awaiting login`

按顺序排查：

```bash
# 1. ptrace 是否放开
sysctl kernel.yama.ptrace_scope    # 必须是 0

# 2. 容器是否有 SYS_PTRACE
docker inspect nekolux --format '{{.HostConfig.CapAdd}}'
# 应该包含 SYS_PTRACE

# 3. QQ 是否真的登录了
docker logs nekolux | grep -i "login\|qr"
```

Docker 里还要确认 seccomp 没拦：

```bash
docker inspect nekolux --format '{{.HostConfig.SecurityOpt}}'
# 应该是 [seccomp=unconfined]
```

### 4.2 `Missing X server`

QQ 找不到 X 显示。

```bash
# Docker：镜像内已配好，通常是 Xvfb 没起来
docker exec nekolux ps aux | grep Xvfb

# 裸机：确认 DISPLAY 环境变量
echo $DISPLAY       # 应该是 :99 或 :0
xdpyinfo -display $DISPLAY | head -3
```

### 4.3 QQ 启动即崩

**原因**：`/dev/shm` 太小（Electron 常见问题）。

**解决**：加 `--shm-size 1gb` 重启容器。

### 4.4 `client bundle not found`

```bash
cd Nekolux && pnpm --filter webui build
```

或重新 `pnpm build:all`。

### 4.5 数据库迁移失败 `Failed to load SQLite native addon`

**原因**：`native/sqlite/prebuilds/linux-x64/` 缺失。

**解决**：

```bash
ls nekolux-dist/native/sqlite/prebuilds/
# 应该有 linux-x64 和 win32-x64 两个目录
```

从源码构建时补齐：

```bash
cp -r packages/runtime/native/sqlite/prebuilds/linux-x64 dist/native/sqlite/prebuilds/
```

### 4.6 内存不足

QQ + Electron + Nekolux 大约吃 800MB。2GB 内存的机器可能紧张：

```bash
free -m
docker stats nekolux
```

### 4.7 服务器定时重启导致 QQ 掉线

某些云主机/面板有定时重启任务。检查：

```bash
crontab -l
ls /etc/cron.d/
uptime -s            # 上次启动时间
```

重启后容器会因 `--restart unless-stopped` 自动起来，但 **QQ 需要重新登录**
（登录态不跨进程恢复）。建议把定时重启安排在业务低峰。

---

## 五、systemd 开机自启

```bash
sudo tee /etc/systemd/system/nekolux.service > /dev/null <<'EOF'
[Unit]
Description=Nekolux
After=docker.service
Requires=docker.service

[Service]
Restart=always
RestartSec=10
ExecStart=/usr/bin/docker start -a nekolux
ExecStop=/usr/bin/docker stop -t 10 nekolux

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now nekolux
```

> 容器本身已带 `--restart unless-stopped`，这个 unit 主要是让 `systemctl` 能统一管理。

---

## 六、安全加固

### 6.1 不要暴露 VNC 到公网

VNC 只有密码保护，暴露公网风险高。用 SSH 隧道：

```bash
# 本地执行
ssh -L 5902:127.0.0.1:5902 user@你的服务器
# 然后 VNC 连 localhost:5902
```

### 6.2 限制 WebUI 监听地址

容器里改 `runtime.json`：

```json
{ "webuiHost": "127.0.0.1" }
```

或者用 Nginx 反代并加认证。

### 6.3 防火墙

```bash
sudo ufw allow 5099/tcp    # WebUI（如果确实要远程访问）
sudo ufw allow 3000/tcp    # OneBot HTTP
# 不开放 5902
```

---

## 七、下一步

- [快速开始](/guide/QUICKSTART) —— 通用流程概览
- [Windows 部署](/guide/DEPLOY-WINDOWS) —— 桌面部署
- [NAS 部署](/guide/NAS-DEPLOYMENT) —— 群晖 / 威联通
- [插件系统](/plugins/PLUGIN-SYSTEM) —— 写插件
- [多账号](/guide/MULTI-ACCOUNT) —— 一机多号
