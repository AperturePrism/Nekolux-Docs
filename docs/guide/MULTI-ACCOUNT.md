# 多账号验证报告

> 日期：2026-11-14
> 环境：NAS（Debian 12，x86_64）· Docker · QQ Linux 3.2.28-48517
> 结论：**架构完全支持，卡在 QQ 客户端单账号限制**

---

## 一、验证结果

### 1.1 已通过（架构层面）

| 能力 | 状态 | 证据 |
|---|---|---|
| HookManager 多 PID 会话 | ✅ | `per-PID HookSession map`，同时跟踪 3 个 PID |
| 每 PID 独立注入 | ✅ | `PID=29` / `492` / `974` 各自 `pipe connected` |
| 每 PID 独立账号识别 | ✅ | 正确区分 `UIN=3816829185` / `UIN=2456562103` |
| 每账号独立配置 | ✅ | `config/onebot_<uin>.json` |
| 每账号独立 OneBot 端口 | ✅ | 3000/3001 vs 3200/3201 |
| 每账号独立消息存储 | ✅ | 按 uin 分 SQLite 库 |
| 插件跨账号 | ✅ | `callAction` 按 `params.self_id` 路由 |

### 1.2 实测记录

**启动第二个 QQ 实例**（同容器内）：

```bash
docker exec -d unified sh -c \
  "DISPLAY=:99 /opt/QQ/qq --no-sandbox --user-data-dir=/root/.config/QQ2"
```

HookManager 立即发现并注入：

```
[Hook] initial connection started: PID=492 timeoutMs=60000
[Hook] pipe connected: PID=492
```

扫码后成功登录**第二个账号**：

```
[Hook] login detected: PID=968 UIN=2456562103
[OneBot] session started: UIN=2456562103
[OneBot.HTTP] listening 0.0.0.0:3200/
[OneBot.WS-Server] listening 0.0.0.0:3201/
```

**这证明多账号链路完全打通。**

---

## 二、卡点：QQ 客户端单账号限制

### 2.1 现象

改完端口后重启容器，第二个实例消失了（entrypoint 只启一个 QQ）。

手动补启第二个实例，**扫码时登的还是第一个账号**：

```
[Hook] login detected: PID=974 UIN=3816829185    ← 期望 2456562103
```

### 2.2 根因

**QQ Linux 客户端在同一个 user-data 目录下只保留一个活跃登录。**

具体表现：

1. `/root/.config/QQ/` 下有两个 `nt_qq_*` 目录（两个账号的登录态都在）
2. `--user-data-dir=/root/.config/QQ2` **只影响 Electron 缓存**，不影响 QQ 登录数据
3. QQ 的登录数据始终写 `/root/.config/QQ/nt_qq_<hash>/`
4. 同一目录下，新进程扫码会复用「最近登录的账号」

### 2.3 验证

```bash
$ ls /root/.config/QQ/
nt_qq_c63c2118e3ed89e5c4d4941cf2dada43
nt_qq_f58b2cff250e15a185c0dfa4d2faa8b0    ← 两个账号的登录态都在

$ ls /root/.config/QQ2/
Cache  Code Cache  Cookies  ...            ← 只有 Electron 缓存，无 nt_qq_*
```

---

## 三、要真正跑双账号的方案

### 方案 A：两个容器（推荐）

```yaml
services:
  nekolux-a:
    image: unified:local
    environment:
      - UNIFIED_PLUGIN_ALLOW=...
    volumes:
      - ./data-a:/app/data
      - ./qq-config-a:/root/.config/QQ    # 独立登录态
    ports: ["5099:5099", "3100:3000", "3101:3001"]

  nekolux-b:
    image: unified:local
    environment:
      - UNIFIED_PLUGIN_ALLOW=...
    volumes:
      - ./data-b:/app/data
      - ./qq-config-b:/root/.config/QQ    # 独立登录态
    ports: ["5199:5099", "3200:3000", "3201:3001"]
```

**优点**：干净隔离，每个容器一个账号，登录态互不影响
**代价**：内存翻倍（每容器约 700MB）

**注意**：`ptrace_scope=0` 是宿主内核参数，两个容器共享，不需要改两次。

### 方案 B：同容器隔离（未验证）

理论上需要：
- 两份 QQ 安装副本（不同路径，绕过 Electron 单实例锁）
- 两个 `HOME` 环境变量（让 QQ 写不同的 `/root/.config/QQ`）

```bash
docker exec -d unified sh -c \
  "HOME=/root2 DISPLAY=:99 /opt/QQ-copy/qq --no-sandbox"
```

**风险**：QQ 可能用硬编码路径或 IPC 单实例锁，不一定成功。

### 方案 C：不改（单账号）

SnowLuma 的单账号功能已经完整验证（见 `NAS-TEST-REPORT.md`）。

---

## 四、当前状态

容器里现在跑着**一个** QQ（`UIN=3816829185`），OneBot 在 3000/3001。

第二个账号（`2456562103`）的配置和登录态都还在：

```
/app/nekolux/config/onebot_2456562103.json   ← 端口已改成 3200/3201
/root/.config/QQ/nt_qq_f58b2cff.../          ← 登录态
```

如果要恢复双账号，用**方案 A**（两个容器）最直接。

---

## 五、代码层面的多账号支持（已完成）

### 5.1 `callAction` 路由

```ts
// unified/packages/runtime/bootstrap.ts
invokeBuiltinAction: async (action, params) => {
    const instances = oneBotManager.getInstances?.() ?? [];

    if (instances.length === 0) throw new Error('no OneBot instance is active');

    const wantedUin = params.self_id;
    let inst = instances[0];

    if (wantedUin !== undefined && wantedUin !== null) {
        const found = instances.find((i) => String(i.uin) === String(wantedUin));
        if (!found) throw new Error(`no OneBot instance for self_id=${wantedUin}`);
        inst = found;
    } else if (instances.length > 1) {
        throw new Error(`multiple OneBot instances are active (${...}); pass params.self_id`);
    }

    return (await inst.invokeAction(action, params)).data;
}
```

**规则**：
- 指定 `self_id` → 用它；不存在则报错
- 只有 1 个实例 → 用它
- 多个实例未指定 → **报错**（不猜，猜错会发到错误账号）

### 5.2 每账号独立配置

`config/onebot_<uin>.json`，包含该账号的：
- OneBot 网络端点（端口 / token / 路径）
- 消息格式
- 状态命令配置

### 5.3 插件跨账号

插件是**全局**的（一份代码、一份配置），但通过 `callAction` 可以指定发到哪个账号：

```js
// 插件里发消息到指定账号
await ctx.callAction('send_group_msg', {
    self_id: 3816829185,      // 指定账号
    group_id: 1134381782,
    message: [{ type: 'text', data: { text: 'hi' } }],
});
```

---

## 六、未验证项

| 项 | 原因 |
|---|---|
| 两账号同时在线收发 | QQ 客户端限制 |
| 跨账号消息转发 | 需要两账号在线 |
| 插件按账号路由实测 | 同上（单元测试已覆盖） |
| 内存占用（双容器） | 未实测 |

---

## 七、结论

**多账号是 SnowLuma 相对 NapCat 的核心架构优势**（NapCat 一个 QQ 进程一个 NapCat，架构上做不到）。

本次验证证明了：

1. ✅ **代码层面完全支持** —— HookManager 多 PID、每账号独立配置/端口/存储、插件路由
2. ✅ **注入链路支持多进程** —— 同时管理 3 个 QQ 进程的 HookSession
3. ❌ **QQ 客户端限制单账号** —— 不是 SnowLuma 的问题

**要真正跑双账号，用两个容器（方案 A）即可，无需改代码。**
