# 运行时装配

> 建立日期：2026-11-13
> 状态：装配完成（10 个测试通过），SnowLuma 侧已加 `onAppCreated` 钩子

---

## 一、目标

把 `unified` 的两个扩展装进 SnowLuma：

| 扩展 | 作用 |
|---|---|
| `@unified/plugin` | 插件系统（加载、事件分发、action 回退） |
| `@unified/native-offsets` | 签名扫描（Windows 协议层拦截 用） |

---

## 二、为什么是「启动后注入」而不是 fork

SnowLuma 已经提供了两个接缝：

| 接缝 | 位置 | 用途 |
|---|---|---|
| `OneBotManager.setPluginBridge()` | `onebot/src/manager.ts` | 事件分发 + action 回退 |
| `initWebUI(..., { plugins })` | `core/src/webui/server.ts` | 插件管理 API |

所以 `unified` **不需要 fork SnowLuma 的 `main()`**，只要在它启动后拿到实例、把桥接装上去。

这样做的代价是：需要能在启动流程里插一脚。

---

## 三、装配流程

```ts
import { createUnifiedRuntime } from '@unified/runtime';

// 时机：OneBotManager 与 Hono app 都已创建、WebUI 开始监听之前
const unified = await createUnifiedRuntime(
    {
        dataDir: 'data',
        pluginAllowList: ['my-plugin'],        // 白名单，空数组 = 不加载
        builtinActionNames: new Set(ACTION_NAMES),
        logger: appLogger,
    },
    honoApp,
);

// 1. 接到 OneBot
oneBotManager.setPluginBridge(unified.bridge);

// 2. 接到 WebUI
initWebUI(port, oneBotManager, hookManager, notificationManager, {
    plugins: unified.webuiHooks,
});

// 3. 退出时
await unified.dispose();
```

### 返回的 `UnifiedRuntime`

| 字段 | 用途 |
|---|---|
| `plugins` | `PluginManager` 实例 |
| `actions` | 插件 action 注册表 |
| `bridge` | 交给 `setPluginBridge()` |
| `webuiHooks` | 交给 `initWebUI(..., { plugins })` |
| `dispose()` | 卸载全部插件 |

---

## 四、接入方式（已实现）

**2026-11-13 完成**：SnowLuma 的 `initWebUI` 加了 `onAppCreated` 钩子。

```ts
initWebUI(port, oneBotManager, hookManager, notificationManager, {
    onAppCreated: async (app) => {
        const unified = await createUnifiedRuntime(
            {
                dataDir: 'data',
                pluginAllowList: config.plugins.enabled,
                builtinActionNames: new Set(ACTION_NAMES),
                logger: appLogger,
            },
            app,
        );

        // 接到 OneBot（事件分发 + action 回退）
        oneBotManager.setPluginBridge(unified.bridge);

        // 返回值被 initWebUI 当作 plugins 钩子，注册管理 API
        return unified.webuiHooks;
    },
});
```

### 为什么需要这个钩子

`honoApp` 在 `initWebUI` 内部创建，外面拿不到。而插件需要在 app 上注册自己的路由（`/api/plugin/<id>/...`）。

`onAppCreated` 在 app 创建后、路由注册前调用，正好解决这个问题。返回值直接当 `plugins` 用，省掉宿主再传一遍。

### 时序

```
initWebUI()
  ├─ const app = new Hono()
  ├─ 安全中间件
  ├─ onAppCreated(app)  ← unified 在这里装配
  │    ├─ createUnifiedRuntime({...}, app)
  │    │    ├─ 创建 plugins 目录
  │    │    ├─ PluginLoader 扫描 + 白名单
  │    │    ├─ PluginManager.loadAll()
  │    │    │    └─ 每个插件的 plugin_init(ctx)
  │    │    │         └─ ctx.router.get(...) → 注册到 app
  │    │    └─ 返回 bridge + webuiHooks
  │    └─ oneBotManager.setPluginBridge(bridge)
  ├─ 注册 /api/plugins（管理 API）
  └─ 其余路由...

---

## 六、测试覆盖

10 个测试，覆盖：

- 插件目录自动创建
- 白名单过滤
- 插件加载
- action 通过桥接暴露
- 内置 action 保护（插件不能覆盖）
- 事件转发
- WebUI 钩子
- 插件路由注册到 Hono
- dispose 卸载

```bash
cd unified
pnpm --filter @unified/runtime test
```

---

## 七、文件索引

| 路径 | 角色 |
|---|---|
| `packages/runtime/src/index.ts` | `createUnifiedRuntime()` 装配逻辑 |
| `packages/runtime/tests/` | 10 个测试 |
| `packages/plugin/src/snowluma-bridge.ts` | 桥接适配器 |
| `packages/plugin/src/hono-router.ts` | Hono 路由适配 |
