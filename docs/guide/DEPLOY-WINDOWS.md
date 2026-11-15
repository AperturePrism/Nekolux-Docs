# Windows 部署（保姆级）

> 适用：Windows 10 / 11，已安装 QQ NT（9.9.x）
> 目标：从零到「QQ 已注入、OneBot 接口可用」
> 预计 15 分钟

---

## 一、检查前置条件

### 1.1 确认 QQ 版本

打开 PowerShell：

```powershell
Get-ChildItem "C:\Program Files\Tencent\QQNT\versions" | Select-Object Name
```

应该看到类似 `9.9.36-53644` 的目录。**记下这个版本号**，后面要确认原生模块匹配。

### 1.2 确认 Node.js

```powershell
node --version
```

需要 **v24.22.1 或更高**。没有的话去 [nodejs.org](https://nodejs.org/) 装 LTS 版本。

### 1.3 确认有管理员权限

Nekolux 通过 ptrace 等价机制注入 QQ 进程，**必须管理员权限**。

验证方法：打开 PowerShell 时右键选「以管理员身份运行」，标题栏会显示「管理员」。

---

## 二、获取运行时

### 方式 A：用现成的发行包

> 主仓库目前托管在私有 Gitea，**发行包不对外公开下载**。有仓库访问权限的话：
>
> 1. 打开 [Releases](https://gitea.binbim.top/AperturePrism/Nekolux/releases)
> 2. 下载 `nekolux-<版本>-win32-x64.zip`
> 3. 解压到比如 `D:\Nekolux\nekolux-dist`
>
> 没有权限就直接用方式 B 从源码构建 —— 流程完全一样。

检查目录结构：

```powershell
Get-ChildItem D:\Nekolux\nekolux-dist
```

应该看到：

```
index.mjs
client\
native\
package.json
release.json
```

**关键检查**：`native\` 里必须有 `nekolux-win32-x64.node` 和 `nekolux-win32-x64.dll`。

```powershell
Get-ChildItem D:\Nekolux\nekolux-dist\native | Where-Object Name -like "*win32*"
```

### 方式 B：从源码构建

```powershell
git clone https://gitea.binbim.top/AperturePrism/Nekolux.git
cd Nekolux
pnpm install

# 必须在仓库根目录跑
pnpm build:all
```

产物在 `dist\`。

> **坑 1**：只跑 `pnpm --filter @nekolux/core build:all` 不会生成 `dist\client\`，
> WebUI 会报 `client bundle not found`。
>
> **坑 2**：构建只复制构建机平台的原生模块。Windows 上构建自然得到 win32 版本，
> 给 Linux 用要另外补。

---

## 三、启动 QQ 并登录

1. 正常打开 QQ，扫码或密码登录
2. **保持 QQ 运行**，不要最小化到托盘也没关系
3. 记住你的 QQ 号

> 为什么要先登录：Nekolux 注入后会等待 QQ 的登录状态，未登录时只会显示
> `awaiting login`。

---

## 四、启动 Nekolux

**以管理员身份**打开 PowerShell：

```powershell
cd D:\Nekolux\nekolux-dist

$env:NEKOLUX_LOG_LEVEL = "debug"
node index.mjs
```

首次启动会打印：

```
[WebUI] listening http://0.0.0.0:5099
[WebUI] WebUi Token: <一串字符>
```

**记下这个 token**，登录 WebUI 要用。

如果 token 丢了，去 `%USERPROFILE%\.nekolux\config\webui.json` 里找，或者删掉它重新生成。

---

## 五、注入 QQ

1. 浏览器打开 `http://127.0.0.1:5099`
2. 输入 token 登录
3. 左侧点「进程注入」
4. 列表里应该能看到 `QQ.exe`（可能有多条，选主进程——PID 最小、内存最大的那个）
5. 点「加载」

等待几秒，状态变成「已连接」就成功了。

### 验证注入成功

回到「总览」页，应该看到：

- 账号：你的 QQ 号
- 状态：在线
- 进程：1 个已注入

或者直接调接口：

```powershell
curl.exe -X POST http://127.0.0.1:3000/ `
  -H "Content-Type: application/json" `
  -d '{\"action\":\"get_login_info\",\"params\":{}}'
```

返回 `{"status":"ok","data":{"user_id":...}}` 即成功。

---

## 六、配置 OneBot 网络

WebUI →「节点配置」→「网络」：

### 加 HTTP 服务端（给机器人框架用）

| 字段 | 值 |
|---|---|
| 类型 | HTTP 服务端 |
| 端口 | 3000 |
| 路径 | `/` |
| 访问令牌 | 建议设一个随机串 |

### 加 WebSocket 服务端（推荐，实时性更好）

| 字段 | 值 |
|---|---|
| 类型 | WS 服务端 |
| 端口 | 3001 |
| 访问令牌 | 同上 |

保存后适配器立即生效，日志会打印 `[OneBot.HTTP] listening 0.0.0.0:3000/`。

---

## 七、常见问题

### 7.1 「进程注入」页看不到 QQ.exe

**原因**：Nekolux 没权限枚举进程。

**解决**：确认 PowerShell 是管理员身份启动的。检查：

```powershell
([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
```

返回 `True` 才对。

### 7.2 加载后一直「awaiting login」

**原因**：QQ 没登录，或登录的账号不在当前 user-data-dir。

**解决**：
1. 确认 QQ 已经登录（不是停在扫码页）
2. 如果 QQ 用了多账号/多实例，确认注入的是**已登录那个进程**
3. 看日志：`docker logs` 或终端输出里应该有 `hook pipe connected`

### 7.3 `client bundle not found`

**原因**：`dist\client\` 缺失。

**解决**：
```powershell
cd Nekolux
pnpm --filter webui build
```

或者重新跑根级 `pnpm build:all`。

### 7.4 注入报 `COMPONENT_LOAD_FAILED`

**原因**：`native\` 里的原生模块与 QQ 版本不匹配，或者文件缺失。

**解决**：
```powershell
Get-ChildItem nekolux-dist\native
```

确认 `nekolux-win32-x64.node` 和 `.dll` 都在。若从源码构建，检查
`packages/runtime/native/` 是否有对应文件。

### 7.5 端口被占用

```powershell
Get-NetTCPConnection -LocalPort 5099,3000,3001 | Select-Object LocalPort,OwningProcess
```

杀掉占用进程，或改 Nekolux 的端口配置。

### 7.6 QQ 更新后失效

QQ 大版本更新可能改变 hook 点。Nekolux 用签名扫描而非硬编码偏移，**小版本更新通常不受影响**；
若真的失效，看 [偏移维护](/protocol/OFFSET-MAINTENANCE)。

---

## 八、让它开机自启

### 方式 A：任务计划程序

1. 打开「任务计划程序」
2. 创建任务 → 常规 → **勾选「使用最高权限运行」**
3. 触发器 → 新建 → 「登录时」
4. 操作 → 启动程序：
   - 程序：`node.exe` 的完整路径（`where node` 查）
   - 参数：`index.mjs`
   - 起始于：`D:\Nekolux\nekolux-dist`
5. 设置 → 勾选「如果任务失败，按以下频率重新启动」

### 方式 B：NSSM（注册成服务）

```powershell
# 下载 nssm.exe 后
nssm install Nekolux "C:\Program Files\nodejs\node.exe" "index.mjs"
nssm set Nekolux AppDirectory D:\Nekolux\nekolux-dist
nssm set Nekolux AppEnvironmentExtra NEKOLUX_LOG_LEVEL=info
nssm start Nekolux
```

> 服务方式默认以 SYSTEM 身份运行，权限足够。但 QQ 必须在**同一个用户会话**里运行，
> 否则注入会失败——所以推荐用「任务计划程序 + 登录时触发」。

---

## 九、安全提醒

- WebUI 默认监听 `0.0.0.0:5099`，**局域网可访问**。只在本机用的话改成 `127.0.0.1`
- 务必设置 WebUI 密码和 OneBot 访问令牌
- Nekolux 只做本地注入，不上传任何数据到第三方

---

## 十、下一步

- [快速开始](/guide/QUICKSTART) —— 通用流程概览
- [Linux 部署](/guide/DEPLOY-LINUX) —— 服务器部署
- [插件系统](/plugins/PLUGIN-SYSTEM) —— 写自己的插件
- [多账号](/guide/MULTI-ACCOUNT) —— 同时挂多个 QQ
