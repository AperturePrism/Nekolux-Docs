# NAS 部署踩坑记录

> 日期：2026-11-14
> 环境：NAS（Debian 12，x86_64）· Docker · QQ Linux 3.2.28-48517
> 结果：**Nekolux 完整跑通**（注入 → 账号识别 → OneBot → 插件）

---

## 一、最终验证结果

```
[Hook] login detected: PID=40 UIN=3816829185
[Bridge] friends loaded: count=7
[Bridge] groups loaded: count=5
[Bridge] member warmup: 505 members, 0 failed
[OneBot] session started: UIN=3816829185
[OneBot.HTTP] listening 0.0.0.0:3000/
[OneBot.WS-Server] listening 0.0.0.0:3001/

# 外部调用
get_group_list   → 5 个群
get_login_info   → {"user_id":3816829185,"nickname":"沈知意"}
demo_echo        → {"echo":"nas-test","from":"demo-plugin"}
```

---

## 二、三个必踩的坑

### 坑 1：`ptrace_scope=1` 导致注入静默失败（最致命）

**现象**：

```
[Hook] awaiting login: PID=28
[Hook] pipe connected: PID=28
```

看起来一切正常，但**永远等不到登录**。没有任何错误日志。

**根因**（strace 抓到）：

```
ptrace(PTRACE_SEIZE, 29, NULL, 0) = -1 EPERM (Operation not permitted)
```

`kernel.yama.ptrace_scope = 1` 的规则是「只允许父进程跟踪子进程」。而我们的进程树是：

```
entrypoint.sh (PID 1)
  ├─ QQ (PID 29)          ← 兄弟
  └─ Nekolux (PID 319)    ← 兄弟
```

**兄弟进程之间不能 ptrace**，所以注入被内核拒绝。Nekolux 失败后**不重试也不报错**，只停在 `awaiting login`。

**修复**：

```bash
sysctl -w kernel.yama.ptrace_scope=0
```

或者永久写入 `/etc/sysctl.d/99-nekolux.conf`：

```
kernel.yama.ptrace_scope = 0
```

> **注意**：这是**宿主内核参数**，容器内改不了（除非 `--privileged` + `/proc/sys` 可写）。
> 在 NAS 上直接改宿主即可，所有容器共享同一个内核。

### 坑 2：Xvfb 未就绪就启动 QQ → QQ 直接退出

**现象**：

```
[59:...] Missing X server or $DISPLAY
[59:...] The platform failed to initialize. Exiting.
```

`docker restart` 时 Xvfb 还没起来，QQ 就启动了。

**根因**：entrypoint 里的等待循环没有严格检查，20 次后不管成功失败都继续。

**修复**（`entrypoint.sh`）：

```bash
XVFB_OK=0
for _ in $(seq 1 60); do
    if DISPLAY=:99 xdpyinfo >/dev/null 2>&1; then
        XVFB_OK=1
        break
    fi
    sleep 0.5
done
[ "$XVFB_OK" -ne 1 ] && { echo "FATAL: Xvfb not ready"; exit 1; }
```

同时给 QQ 加一次重试。

### 坑 3：QQ 登录态丢失

**现象**：容器重启后 QQ 需要重新扫码。

**根因**：napcat 镜像的 `/app/.config/QQ` 是 **VOLUME**（匿名卷）。`docker rm -f` 后新建容器会挂一个**新的空卷**。

**修复**：显式挂载到宿主目录。

```bash
-v /astrbot/unified/qq-config:/app/.config/QQ
```

---

## 三、次要问题

### OneBot 默认只监听 127.0.0.1

容器内 `127.0.0.1:3000` 外部访问不到。改配置：

```json
{ "networks": { "httpServers": [{ "host": "0.0.0.0", ... }] } }
```

文件：`/app/nekolux/config/onebot_<uin>.json`

### napcat 镜像的 apt 状态是坏的

`apt-get install` 报 `Unmet dependencies`。先修：

```dockerfile
RUN apt-get update || true; \
    DEBIAN_FRONTEND=noninteractive apt-get -f install -y || true; \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      xvfb x11vnc openbox x11-utils strace
```

### Node.js 从 nodejs.org 下载卡住

国内 NAS 拉不动。用 npmmirror：

```
https://registry.npmmirror.com/-/binary/node/v24.22.1/node-v24.22.1-linux-x64.tar.xz
```

### napcat 镜像改了 QQ 的 package.json

`main` 指向 `./loadNapCat.js`（进程内加载 NapCat）。Nekolux 是进程外 hook，必须还原：

```dockerfile
RUN sed -i 's#"main"[[:space:]]*:[[:space:]]*"[^"]*"#"main": "./application.asar/app_launcher/index.js"#' \
    /opt/QQ/resources/app/package.json
```

---

## 四、动态分析发现（反编译补充）

### 注入用 memfd，磁盘无痕迹

```
/memfd:nnp-resident-dispatch (deleted)
```

加载后立即 unlink。这是**反检测设计**——磁盘上找不到注入文件。

### 进程发现方式

strace 显示它遍历 `/proc`：

```
openat("/proc", O_DIRECTORY)
openat("/proc/1/comm")
openat("/proc/28/comm")
openat("/proc/28/cmdline")
openat("/proc/28/maps")
```

先读 `comm` 匹配进程名，再读 `cmdline` + `maps` 判断是否主进程。

### 定位策略（字符串证据）

```
nnphook::linux_backend::RuntimeTargets
MSFCoreService send features missing or ambiguous
MSFCoreService packet-state callback/RTTI chain unresolved
```

**靠 ELF 符号 + RTTI 链**在运行时定位，不是硬编码偏移。这是跨 QQ 版本的来源。

---

## 五、完整部署步骤

```bash
# 1. 宿主准备（关键）
sudo sysctl -w kernel.yama.ptrace_scope=0
mkdir -p /astrbot/unified/{data,config,qq-config}

# 2. 构建镜像
cd /tmp/unified-build
docker build -t unified:local .

# 3. 启动
docker run -d --name unified \
  --cap-add SYS_PTRACE \
  --security-opt seccomp=unconfined \
  --shm-size 1gb \
  -e VNC_PASSWORD=<密码> \
  -e NEKOLUX_LOG_LEVEL=info \
  -e UNIFIED_PLUGIN_ALLOW=demo-plugin \
  -p 5099:5099 -p 5902:5900 -p 3100:3000 -p 3101:3001 \
  -v /astrbot/unified/data:/app/data \
  -v /astrbot/unified/config:/app/nekolux/config \
  -v /astrbot/unified/qq-config:/app/.config/QQ \
  unified:local

# 4. VNC 扫码登录
#    VNC: <host>:5902

# 5. 验证
curl -X POST http://<host>:3100/ \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <token>' \
  -d '{"action":"get_login_info","params":{}}'
```

---

## 六、排障速查

| 现象 | 检查 |
|---|---|
| `awaiting login` 但 QQ 已登录 | `cat /proc/sys/kernel/yama/ptrace_scope` 必须是 0 |
| QQ 启动即退 | `docker logs unified \| grep "X server"` |
| 重启后要重新扫码 | 检查 `/app/.config/QQ` 是否挂到宿主 |
| 外部连不上 3000/3001 | 检查 `onebot_<uin>.json` 的 `host` 是否为 `0.0.0.0` |
| `COMPONENT_LOAD_FAILED` | 同上，ptrace_scope 或 QQ 未就绪 |

---

## 七、文件索引

| 路径 | 说明 |
|---|---|
| `unified/docker/Dockerfile` | 镜像定义（含 apt 修复、QQ 入口还原） |
| `unified/docker/entrypoint.sh` | 启动编排（Xvfb 严格等待 + QQ 重试） |
| `tools/nas-run-unified.sh` | 容器启动脚本（含全部挂载） |
| `tools/nas-onebot.py` | 通过 SSH 调 OneBot action 的辅助脚本 |
| `tools/nas-run.py` | 通过 SSH 在 NAS 执行命令 |
