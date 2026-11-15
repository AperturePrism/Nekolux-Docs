# 插件系统

> 建立日期：2026-11-13 · 更新：2026-11-14
> 状态：完整。加载器 / 管理器 / action 注册表 / 配置持久化 / callAction /
> 配置 UI / 内置 action 保护 / 热重载 / Worker 沙箱 / 插件市场
> 测试：75 个 plugin + 13 个 runtime

---

## 一、为什么需要

SnowLuma 完全没有插件系统，NapCat 有完整实现。这是两者最大的能力差距。

**但不能照抄 NapCat** —— 两边的 `ctx` 语义完全不同：

| 字段 | NapCat | 本项目 |
|---|---|---|
| `core` | `NapCatCore`（NodeIKernel session） | 不暴露（SnowLuma 走封包，没有 session 概念） |
| `oneBot` | `NapCatOneBot11Adapter` | 不暴露（用 `actions` 注册代替） |
| `actions` | `ActionMap`（class 实例表） | `PluginActionRegistrar`（函数注册） |
| `router` | Express | `PluginRouter`（框架无关的最小接口） |

所以 **NapCat 插件不能直接拷过来用**。这是刻意的设计——假装兼容只会让插件在运行时出怪问题。

---

## 二、插件结构

```
plugins/
└─ my-plugin/
   ├─ package.json      # 必需
   ├─ index.js          # 入口（或 package.json 的 main 指定）
   ├─ config/           # 框架创建，存 config.json
   └─ data/             # 框架创建，插件自己用
```

### package.json

```json
{
  "name": "my-plugin",
  "plugin": "my-plugin",
  "version": "1.0.0",
  "main": "index.js",
  "description": "示例插件",
  "author": "you"
}
```

- `plugin` 或 `name` 作为插件 ID，**必须与目录名一致**（否则 `getPluginExports` 路径解析会有歧义）
- `main` 默认 `index.js`

### index.js

```js
export function plugin_init(ctx) {
    ctx.logger.info('hello from %s', ctx.id);

    // 注册一个 OneBot action
    ctx.actions.register('my_hello', (params) => {
        return { greeting: `hi ${params.name ?? 'world'}` };
    });
}

export function plugin_onmessage(ctx, event) {
    ctx.logger.info('message %d from %d', event.message_id, event.user_id);
}

export function plugin_cleanup(ctx) {
    ctx.logger.info('bye');
}

export const plugin_config_schema = [
    { key: 'enabled', type: 'boolean', label: '启用', default: true },
    { key: 'prefix', type: 'string', label: '命令前缀', default: '#' },
];
```

---

## 三、生命周期

| 钩子 | 何时调用 | 必需 |
|---|---|---|
| `plugin_init(ctx)` | 加载时一次。**抛异常 = 加载失败** | ✅ |
| `plugin_onmessage(ctx, event)` | 收到消息事件（`post_type === 'message'`） | — |
| `plugin_onevent(ctx, event)` | 收到任意事件（在 onmessage 之后） | — |
| `plugin_cleanup(ctx)` | 卸载时 | — |
| `plugin_config_schema` | 加载时读取，供 WebUI 渲染表单 | — |
| `plugin_get_config(ctx)` | `ctx.getConfig()` 时 | — |
| `plugin_set_config(ctx, config)` | `ctx.setConfig()` 时 | — |
| `plugin_on_config_change(ctx, key, value, config)` | `reactive: true` 的字段变化时 | — |

**异常隔离**：任何钩子抛异常都只影响该插件自己，不会中断事件流或拖垮其他插件。

**回滚**：`plugin_init` 抛异常时，它已经注册的 action 会被自动清理，不留半残状态。

---

## 四、ctx 接口

```ts
interface PluginContext {
    readonly id: string;
    readonly name: string;
    readonly version: string;

    readonly pluginPath: string;   // 插件目录
    readonly configPath: string;   // <pluginPath>/config
    readonly dataPath: string;     // <pluginPath>/data

    readonly logger: PluginLogger;  // 自动加 [plugin:<id>] 前缀
    readonly router: PluginRouter;  // WebUI 路由

    readonly actions: PluginActionRegistrar;

    /** 调用宿主的内置 OneBot action（如 send_group_msg）。 */
    callAction<T = unknown>(action: string, params: Record<string, unknown>): Promise<T>;

    getPluginExports<T>(pluginId: string): T | undefined;
    getConfig<T>(): T;
    setConfig(config: Record<string, unknown>): Promise<void>;
}
```

### actions

```ts
ctx.actions.register(name, handler);   // handler: (params) => data
ctx.actions.unregister(name);
```

- **只能新增，不能覆盖内置 action**（覆盖会让排障变噩梦）
- 注册的 action 会出现在 OneBot 的 `get_supported_actions` 和 MCP catalog 里
- 卸载插件时自动清理

### callAction —— 插件操作 QQ 的唯一通道

```ts
// 插件想发消息，只能走这个入口
await ctx.callAction('send_group_msg', {
    group_id: event.group_id,
    message: [{ type: 'text', data: { text: '收到～' } }],
});
```

**为什么不让插件直接拿 QQ 能力**：

| 方案 | 问题 |
|---|---|
| 暴露 `bridge` / `oneBot` 实例 | 插件绕过 OneBot 抽象，直接操作协议层 |
| 暴露原始封包发送 | 插件能构造任意 OIDB，安全边界消失 |
| **只暴露 `callAction`** | 插件复用 OneBot 的 214 个 action，能力完整且边界清晰 |

**行为**：

- 返回 OneBot 响应的 `data` 部分
- action 不存在 / 执行失败时**抛异常**（插件必须处理）
- 宿主未提供实现时抛错，**不静默失败**
- 多账号时路由到第一个活跃实例（按账号路由留给后续扩展）

> **这是 v0.1 新增的能力**。最初的 `PluginContext` 只有 `actions`（注册）没有调用能力，
> 导致「关键词自动回复」这类插件无法实现——插件能收到消息但没法回。实测发现后补上。

### ctx.packets —— 原始封包监听

`callAction` 之上还有一层更底层的能力：**看得到 OneBot 事件之前的原始 SSO 包**。

```js
export function plugin_init(ctx) {
    // 精确订阅某条命令（框架侧有索引，非目标包不进回调）
    ctx.packets.on({ cmd: 'trpc.msg.msg_svc.MsgService.SsoGroupRecallMsg' }, (packet) => {
        // packet = { type, uin, cmd, seq, body, retCode, time }
        // type: 0 = 发送（客户端→服务器），1 = 接收
        stats.recall += 1;
    });

    // 也可以按方向订阅
    ctx.packets.on({ type: 1 }, (packet) => {});
}

// 或者用全局钩子（所有包）
export function plugin_onpacket(ctx, packet) {}
```

| 能力 | 说明 |
|---|---|
| `ctx.packets.on({ cmd })` | 按命令精确订阅，走索引，开销最低 |
| `ctx.packets.on({ type })` | 按方向订阅（0=send / 1=recv） |
| `ctx.packets.on({})` | 全量订阅（慎用） |
| `plugin_onpacket(ctx, packet)` | 全局钩子，等价于全量订阅 |
| 返回值 | `ctx.packets.on()` 返回取消订阅函数；插件卸载时框架也会统一清理 |

**与 NapCat 的对应关系**：

| NapCat | 本项目 |
|---|---|
| `core.context.packetHandler.onCmd(cmd, cb)` | `ctx.packets.on({ cmd }, cb)` |
| `onSend` / `onRecv` | `on({ type: 0 })` / `on({ type: 1 })` |
| `onExact(type, cmd, cb)` | `on({ type, cmd }, cb)` |
| `onAll(cb)` | `on({})` 或 `plugin_onpacket` |

**性能纪律**（重要）：

- 回调跑在**包处理路径**上，同一条链上所有插件**串行**调用
- 全量登录时包流可达上千包 —— 回调里**只做轻量记账**，重活（落盘、网络、大计算）
  自己转成队列异步处理
- 回调抛错会被框架捕获并记日志，不影响其他插件，也不影响协议主链路
- 需要按命令过滤时用 `ctx.packets.on({ cmd })`，**别在全局钩子里自己做前缀匹配**

**边界**：包体是**已解密**的明文字节，但不提供密钥材料；插件能看能统计，
不改变「不能绕开 OneBot 发包」的约束（发包仍走 `callAction('send_packet', ...)`）。


### router

```ts
ctx.router.get('/status', (req) => ({ ok: true }));
ctx.router.post('/do', async (req) => {
    return { received: req.body };
});
```

挂载点：
- API → `/api/plugin/{pluginId}/...`
- 静态 → `/plugin/{pluginId}/files/...`

### 配置

```js
export function plugin_init(ctx) {
    const cfg = ctx.getConfig();       // 读
    ctx.setConfig({ ...cfg, x: 1 });   // 写（异步，落盘到 config/config.json）
}
```

配置文件的默认读写是纯 JSON。如果插件需要自定义逻辑，实现 `plugin_get_config` / `plugin_set_config`。

---

## 五、安全边界

| 措施 | 说明 |
|---|---|
| **白名单** | 默认空 —— 一个都不加载。必须显式配置才放行 |
| **目录名 = ID** | 防止 `getPluginExports` 路径歧义 |
| **内置 action 保护** | 插件不能注册与内置同名的 action（`PluginActionRegistry` 的 reserved 集） |
| **防目录逃逸** | 入口文件必须在插件目录内，`../../../etc/passwd` 被拒 |
| **敏感词扫描** | 命中即拒绝（发卡/卡密/赌博/色情等）。**仅启发式威慑，混淆可绕过** |
| **异常隔离** | 插件崩溃不影响框架 |
| **action 只增不改** | 不能覆盖内置 action |

### 关于白名单默认空

这是刻意的。插件能拿到完整的 OneBot action 注册能力 —— 默认放行等于默认信任任意代码。

启用方式：

```ts
const loader = new PluginLoader({
    pluginRoot: '/path/to/plugins',
    allowList: ['my-plugin'],   // 显式列出
});
```

---

## 六、接入框架

**已接线**（2026-11-13）。SnowLuma 侧加了三个接入点：

| 位置 | 改动 |
|---|---|
| `onebot/src/instance.ts` | `pluginDispatcher` 字段 + `setPluginBridge()` |
| `onebot/src/api-handler.ts` | `pluginActionResolver` + `setPluginActionResolver()` |
| `onebot/src/manager.ts` | `setPluginBridge()` 转发给所有实例（含新建的） |
| `packages/plugin/src/snowluma-bridge.ts` | 把 `PluginManager` 适配成上面的形状 |

### 宿主侧接线代码

```ts
import {
    PluginActionRegistry,
    PluginLoader,
    PluginManager,
    createPluginBridge,
} from '@unified/plugin';

// 1. action 注册表 —— 内置 action 名作为保留集
const actions = new PluginActionRegistry(new Set(BUILTIN_ACTION_NAMES));

// 2. 加载器
const loader = new PluginLoader({
    pluginRoot: path.join(dataDir, 'plugins'),
    allowList: config.plugins.enabled,
    log: (level, msg) => logger[level](msg),
});

// 3. 管理器
const manager = new PluginManager({
    loader,
    createLogger: (scope) => createLogger(scope),
    createRouter: (pluginId) => makeHonoRouter(app, pluginId),
    actions,
});

await manager.loadAll();

// 4. 桥接到 OneBot
oneBotManager.setPluginBridge(
    createPluginBridge({
        manager,
        hasAction: (name) => actions.has(name),
        invokeAction: (name, params) => actions.invoke(name, params),
    }),
);
```

### 桥接的两个关键行为

1. **`dispatch` 只转发有 `post_type` 的事件** —— SnowLuma 内部偶尔产生不完整形状，插件不该看到半成品
2. **`resolveAction` 同步返回 `undefined`** —— 未注册的 action 立刻让 OneBot 按「unknown action」处理，不制造空 Promise

### 事件分发位置

在 `instance.ts` 的 `dispatchEvent` 里，`networkManager.emitEvent` **之前**：

```ts
this.traceEventHandoffTerminal(event, startedAt, 'reporting_started');

if (this.pluginDispatcher) {
    void this.pluginDispatcher(event);   // 不 await：插件慢不拖累网络上报
}

await this.networkManager.emitEvent(event);
```

用 `void` 而不是 `await` 是刻意的：插件异常由 `PluginManager` 内部隔离，不会冒泡。

### action 回退位置

在 `api-handler.ts` 的 `handleInContext` 里，内置 handler 未命中时：

```ts
const registered = this.handlers.get(action);

if (!registered) {
    if (this.pluginActionResolver) {
        const pluginResult = await this.pluginActionResolver(action, params);
        if (pluginResult !== undefined) {
            return okResponse(pluginResult);   // 插件接住了
        }
    }
    return failedResponse(RETCODE.UNKNOWN_ACTION, 'unknown action');
}
```

**内置永远优先** —— 插件不能覆盖内置 action。

### 接线状态（2026-11-14 全部完成）

| 项 | 状态 |
|---|---|
| WebUI 插件管理页 | ✅ `/plugins`（配置 / 重载按钮） |
| WebUI 插件市场页 | ✅ `/plugin-market`（本地 + 远端索引） |
| WebUI 路由适配 | ✅ `createHonoPluginRouter()` + `registerPluginAdminRoutes()` |
| 插件配置热更新通知 | ✅ `PUT /api/plugins/:id/config` → `notifyConfigChange()` |

---

## 七、与 NapCat 插件的差异

迁移 NapCat 插件时需要改的地方：

| NapCat 用法 | 本项目对应 |
|---|---|
| `ctx.core.apis.msg.sendMsg(...)` | ❌ 无。用 `ctx.actions` 注册 action，让调用方发 |
| `ctx.oneBot.actions.get(...)` | `ctx.actions.register(...)` |
| `ctx.router.get(path, expressHandler)` | `ctx.router.get(path, (req) => data)` |
| `ctx.NapCatConfig` | ❌ 无。用 `plugin_config_schema` + `ctx.getConfig()` |
| `plugin_config_controller` | `plugin_config_ui(ctx, ui)` —— 同名能力，见 §七.1 |
| `ctx.router.page()` / `.static()` | `ctx.router.page(name, fn)` / `.static(subdir)` —— 见 §七.2 |
| `ctx.pluginManager` | `ctx.plugins` —— 只读，见 §七.3 |
| `ctx.oneBot.networkManager.registerAdapter` | ❌ 无。用 `ctx.router` 起 HTTP 端点 |

**核心差异**：NapCat 插件能直接调 NodeIKernel 的能力（发消息、查群成员等）；本项目的插件**只能注册 action**，实际能力由 OneBot 层提供。

这是架构决定的：SnowLuma 走封包，没有「session」这种能直接操作 QQ 的对象。


---

## 七、扩展能力（2026-11-15）

### 七.1 动态配置 UI —— `plugin_config_ui`

静态 `plugin_config_schema` 只能描述固定表单。需要按运行时状态增删字段时：

```js
export function plugin_config_ui(ctx, ui) {
    ui.updateSchema([
        { key: 'enabled', type: 'boolean', label: '启用', reactive: true },
    ]);

    // 按当前配置决定是否追加字段
    if (ctx.getConfig().enabled) {
        ui.addField({ key: 'threshold', type: 'number', label: '阈值', default: 5 });
    }
}
```

| 方法 | 作用 |
|---|---|
| `addField(field)` | 追加字段（同 key 时替换） |
| `removeField(key)` | 删除字段 |
| `updateField(key, patch)` | 改字段属性（key 不可改） |
| `updateSchema(schema)` | 整体替换 |
| `showField(key)` / `hideField(key)` | 切换 `hidden` |
| `getSchema()` / `getConfig()` | 读当前 schema / 配置快照 |

变更会经宿主的 `onConfigSchemaChange` 广播（WebUI 可据此推 SSE）。
`getPluginConfigSchema(id)` 有控制器时返回动态 schema，否则回退静态那份。

**并发与隔离**：`getSchema()` 返回副本，调用方改动不影响内部状态；
`onChange` 抛错被吞掉并记日志（UI 刷新失败不影响插件业务）。

### 七.2 扩展页与静态资源

```js
export function plugin_init(ctx) {
    // HTML 扩展页：浏览器直接访问
    ctx.router.page('dashboard', () => `<!doctype html><h1>Hello</h1>`);

    // 插件目录下的 webui/ 作为静态资源根
    ctx.router.static('webui');
}
```

| 端点 | 鉴权 | 用途 |
|---|---|---|
| `/api/plugin/{id}/*` | ✅ 需要 | JSON API（原有） |
| `/plugin/{id}/page/{name}` | ❌ 公开 | HTML 扩展页 |
| `/plugin/{id}/static/*` | ❌ 公开 | 静态资源 |

**为什么公开端点也安全**：插件代码本身已经跑在主进程里，是完全可信的。
这里防的是**路径穿越**（`..`）和**误暴露任意文件**（扩展名白名单），不是防插件：

- 解析后的绝对路径必须仍在声明的目录内（`path.relative` 校验）
- 只放行 HTML/CSS/JS/图片/字体/文本扩展名，其余 415
- 页面名限制为 `[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}`

**没有 `apiNoAuth`**：JSON API 一律走鉴权。需要无鉴权数据就写进页面 HTML ——
开一个免鉴权的数据 API 等于给插件留后门。

### 七.3 插件内省 —— `ctx.plugins`

```js
export function plugin_init(ctx) {
    if (ctx.plugins.has('other-plugin')) {
        const api = ctx.plugins.exportsOf('other-plugin');
    }
}
```

| 方法 | 说明 |
|---|---|
| `list()` | 已加载插件的运行态信息 |
| `get(id)` / `has(id)` | 按 id 查 |
| `listFailures()` | 加载失败的插件（含原因） |
| `exportsOf(id)` | 另一插件的 `exports` |

**只读**：不提供 load/unload —— 允许插件互相卸载会让排障变成噩梦。

**加载顺序**：按目录名字母序串行加载。插件在 `plugin_init` 里只能看到
**已经加载完**的插件。需要跨插件协作时，把查询放到 `plugin_onmessage` 或
路由处理里，而不是 `init`。

---

## 八、测试覆盖

**134 个测试**（`packages/plugin/tests/`），覆盖：

- 加载器：白名单、目录名校验、目录逃逸、敏感词、排序、日志
- 管理器：生命周期、失败隔离、action 回滚、事件分发、配置持久化
- action 注册表：保留名、重复注册、调用、排序
- **原始封包**：订阅过滤（方向/命令/组合）、索引去重、卸载清理、异常隔离
  （`packets.test.ts` 12 个 + `manager-packets.test.ts` 7 个）
- 沙箱：Worker 隔离、RPC 代理、超时与内存上限
- 市场：索引校验、sha256、包体上限、安全 id
- **动态配置 UI**：增删改字段、通知次数、副本隔离、非法操作告警、抛错不传播
  （`config-ui.test.ts` 15 + `manager-config-ui.test.ts` 6）
- **静态资源**：路径穿越防护（6 种攻击形态）、扩展名白名单、content-type、
  页面名校验（`webui-assets.test.ts` 12）
- **插件内省**：自省可见性、跨插件导出、只读约束、加载顺序语义
  （`plugin-manager-view.test.ts` 7）

```bash
cd unified
pnpm --filter @unified/plugin test
```

---

## 九、未实现

| 项 | 说明 |
|---|---|
| 插件间依赖解析 | 有 `ctx.plugins` / `getPluginExports`，但**无加载顺序保证** —— 按目录名字母序串行加载，插件在 `plugin_init` 里只能看到已经加载完的插件 |
| 无鉴权 JSON API（`apiNoAuth`） | **有意不做**。静态资源与扩展页是公开的（浏览器直连），但 JSON API 一律走 `/api/plugin/{id}/` 鉴权前缀 —— 免鉴权数据 API 等于给插件开后门 |
| 配置表单构造器 | NapCat 有 `ctx.NapCatConfig.text(...)` 之类的 builder，我们只接受原始 schema 对象（约 2 小时可补） |

> **已实现**（2026-11-14）：
> - `ctx.callAction` —— 插件操作 QQ 的唯一通道
> - WebUI 插件配置页（`/api/plugins/:id/config` + 动态表单）
>
> **已实现**（2026-11-15）：
> - `ctx.packets` / `plugin_onpacket` —— 原始封包监听（见上文）
> - `plugin_config_ui` + `PluginConfigUiController` —— 动态配置表单
>   （`addField` / `removeField` / `updateField` / `updateSchema` / `show` / `hide`，
>   变更经 `onConfigSchemaChange` 广播给 WebUI）
> - `ctx.router.page(name, handler)` —— 插件自带 HTML 扩展页
>   （`/plugin/{id}/page/{name}`）
> - `ctx.router.static(subdir)` —— 插件目录下的静态资源
>   （`/plugin/{id}/static/*`，含路径穿越防护 + 扩展名白名单）
> - `ctx.plugins` —— 只读自省视图（`list` / `get` / `has` / `listFailures` / `exportsOf`）

> - 内置 action 保护 —— 插件不能覆盖（见下）
> - `callAction` 多账号路由（`params.self_id` 指定）

---

## 十、文件索引

| 路径 | 角色 |
|---|---|
| `packages/plugin/src/types.ts` | 公共契约（ctx / 钩子 / 配置 schema） |
| `packages/plugin/src/loader.ts` | 扫描 + 校验 + 动态 import |
| `packages/plugin/src/manager.ts` | 生命周期 + 事件分发 + 配置 |
| `packages/plugin/src/actions.ts` | action 注册表 |
| `packages/plugin/tests/` | 75 个测试 |

---

## 十一、内置 action 保护（2026-11-14 修复）

**问题**：`bootstrap.ts` 的保留集是空 `new Set()`，插件注册 `send_group_msg`
会成功，然后劫持所有发消息。文档写着「插件不能覆盖内置 action」，实际没生效。

**修复**：

```
bootstrap 三层回退拿内置 action 名：
  1. OneBotManager.listBuiltinActionNames()   ← 静态表，编译期确定，最可靠
  2. UNIFIED_BUILTIN_ACTIONS 环境变量         ← 手工兜底
  3. 空集                                     ← 危险状态，打 ERROR 日志
```

Nekolux 侧新增：

| 位置 | 方法 |
|---|---|
| `api-handler.ts` | `listActionNames()` —— 已注册的内置 action 名 |
| `instance.ts` | `listActionNames()` —— 转发 |
| `manager.ts` | `static listBuiltinActionNames()` —— **不依赖实例**，登录前就能拿 |

`core/src/index.ts` 的 `onAppCreated` 把 `OneBotManager` 构造器一并传给 bootstrap。

**验证**：插件尝试注册 `get_group_list` → 抛 `action "get_group_list" is reserved
by a built-in action`，插件记为加载失败，不加载。

---

## 十二、插件配置 UI（2026-11-14 补齐）

### 后端路由

```
GET  /api/plugins/:id/config   → { config, schema }
PUT  /api/plugins/:id/config   → { ok }
```

宿主没提供 `getConfig` / `setConfig` / `getConfigSchema` 时整块跳过 —— 老宿主兼容。

### 前端

`plugins-page.tsx` 的每个插件卡片加了「配置」按钮，打开
`plugin-config-dialog.tsx`。表单**完全由 `plugin_config_schema` 驱动**：

| `type` | 控件 |
|---|---|
| `string` | `<Input>` |
| `number` | `<Input type="number">` |
| `boolean` | checkbox |
| `select` | `<select>` |
| `multi-select` | 逗号分隔输入（简化实现） |
| `text` / `html` | `<textarea>` |

宿主不认识任何具体字段 —— 只按 `type` 选控件。这是「配置 UI 自动化」的核心。

### 保存后的通知

`setPluginConfig` 会对每个字段调 `notifyConfigChange`，插件可以据此热应用
（只对 `reactive: true` 的字段有意义，但当前实现对全部字段都通知）。

---

## 十三、多账号路由（2026-11-14 修复）

**原实现**：`const inst = instances[0]` —— 永远第一个账号。

**现规则**：

| 情况 | 行为 |
|---|---|
| `params.self_id` 指定了账号 | 用它；不存在则**报错** |
| 只有一个实例 | 用它 |
| 多个实例且没指定 | **报错**，列出所有账号让调用方选 |

**不猜**是刻意的 —— 猜错会把消息发到错误的账号，比报错更糟。

---

## 十四、热重载（2026-11-14 实现）

```ts
await manager.reload('my-plugin');   // 卸载 → 重新发现 → 绕过 ESM 缓存加载
```

**ESM 缓存问题**：`import()` 以完整 URL 为 key，同一路径第二次 import 返回**旧模块**。
解法：`importModule(plugin, true)` 加 `?v=<时间戳>` query 参数。

**限制**：
- `package.json` 改动（ID / main）需要重启 —— `discover()` 结果不重新扫描
- 插件 spawn 的子进程 / 外部连接必须由 `plugin_cleanup` 释放干净

**WebUI**：插件卡片的「重载」按钮 → `POST /api/plugins/:id/reload`

---

## 十五、沙箱（2026-11-14 实现）

插件跑在 **Worker 线程**里，与主进程隔离。

```ts
createUnifiedRuntime({
    dataDir,
    builtinActionNames,
    logger,
    sandbox: { hookTimeoutMs: 10_000, maxOldGenerationSizeMb: 256 },  // 开启
});
```

### 双向 RPC 是核心

**函数不能跨 Worker 边界**（`DataCloneError`），所以：

```
Worker:  ctx.actions.register('foo', fn)
         → fn 留在 Worker 本地表，只发 name 过来
Host:    注册代理 handler
         → 收到调用时发 { kind: 'invoke-action', name, params }
Worker:  执行真 fn，发回 { kind: 'invoke-result', value }
```

`ctx.router.get()` 同理，用 `<method>:<path>` 作 key。

### 能力对照

| 能力 | 非沙箱 | 沙箱 |
|---|---|---|
| `plugin_init` / 钩子 | 主线程 | Worker |
| `actions.register` | 主线程 | Worker（代理） |
| `router.*` | 主线程 | Worker（代理） |
| `callAction` / `logger` / 配置 | 主线程 | RPC 转发 |
| 访问 `process` / `fs` | ✅ | ❌（Worker 里仍可通过 node: 内置模块拿到，**不是绝对隔离**） |

### 代价

- handler 变成异步（多一次消息往返，约 0.1ms）
- Worker 启动开销（每个插件一个，约 30-50ms）
- 错误栈跨线程，调试稍麻烦

### 构建要求

`host-worker.ts` 要编译成 JS（Worker 不能直接跑 TS）：

```bash
node build-worker.mjs   # → dist/host-worker.js
```

`pnpm test` 与生产构建都会先跑这一步。

---

## 十六、插件市场（2026-11-14 实现）

两种发现方式并存：

### 远端索引

```json
{
  "version": 1,
  "plugins": [{
    "id": "keyword-reply",
    "name": "关键词回复",
    "version": "1.0.0",
    "description": "...",
    "author": "...",
    "downloadUrl": "https://example.com/keyword-reply.tar.gz",
    "sha256": "..."
  }]
}
```

配置 `marketIndexUrl` 后：
```
GET  /api/plugins/market           → 拉索引
POST /api/plugins/market/install   → 下载 + 校验 + 解包
```

### 本地扫描

```
GET    /api/plugins/local        → 扫描 plugins/，标出 enabled / loaded
DELETE /api/plugins/:id/local    → 删除插件目录
```

### 安全

| 措施 | 说明 |
|---|---|
| `isSafeId` | ID 只能含 `[A-Za-z0-9._-]`，拒绝 `..` / 路径分隔符 |
| sha256 校验 | 索引提供时必须匹配，否则拒绝安装 |
| 大小上限 | 默认 10 MiB（`maxPackageBytes`） |
| 超时 | 默认 15s（`fetchTimeoutMs`） |
| **不自动启用** | 安装只放文件，启用仍需改白名单 + 重启 |
| 失败清理 | 安装失败删除半残目录 |

> 下载的插件**仍然要过** `PluginLoader` 的白名单 + 敏感词 + 目录逃逸检查 ——
> 市场不绕过这些。

### WebUI

`/plugin-market` 页：本地插件列表（含启用状态）+ 远端索引（一键安装）。
