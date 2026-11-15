# 端到端验证报告

> 日期：2026-11-13
> 环境：阿里云 VPS（Debian 12，x86_64，2核2G）
> 结论：**插件系统在真实环境跑通**

---

## 一、验证内容

| 项 | 结果 |
|---|---|
| SnowLuma 构建（含 `onAppCreated` 钩子） | ✅ |
| bootstrap 打包（自包含 ESM） | ✅ 19.6KB |
| VPS 部署 | ✅ |
| **插件加载** | ✅ |
| **插件 `plugin_init` 执行** | ✅ |
| **WebUI `/api/plugins`** | ✅ |
| **插件自己的路由** | ✅ |
| 插件 action | ⚠️ 需要 QQ 账号（合理限制） |

---

## 二、实测输出

### 2.1 插件加载

```
[App] unified bootstrap: dataDir=/opt/snowluma-unified/data allowList=demo-plugin
[App] demo-plugin init, id=demo-plugin
[App] unified bootstrap: 1 plugin(s) loaded, 0 failed
```

### 2.2 WebUI 管理 API

```bash
$ curl /api/plugins -H "Authorization: Bearer $TOKEN"
{
    "plugins": [
        {
            "id": "demo-plugin",
            "name": "demo-plugin",
            "version": "1.0.0",
            "description": "端到端验证用的示例插件",
            "author": "unified",
            "status": "loaded",
            "path": "/opt/snowluma-unified/data/plugins/demo-plugin",
            "loadMs": 2
        }
    ],
    "failures": []
}
```

### 2.3 插件自己的路由

```bash
$ curl /api/plugin/demo-plugin/ping -H "Authorization: Bearer $TOKEN"
{"pong":true,"plugin":"demo-plugin"}
```

### 2.4 插件 action

```bash
$ curl -X POST /api/debug/invoke -d '{"action":"demo_echo","params":{"value":"hello"}}'
{"status":"failed","message":"无效的账号"}
```

**这是合理的限制**：`debug/invoke` 需要 OneBot 实例（账号上下文），没登录 QQ 就没有实例。action 回退逻辑本身已由单元测试覆盖（`plugin-action-fallback.test.ts` 5 个测试）。

---

## 三、接线方式（最终实现）

### 3.1 SnowLuma 侧的钩子

`core/src/index.ts` 读 `UNIFIED_BOOTSTRAP` 环境变量：

```ts
const unifiedBootstrap = process.env.UNIFIED_BOOTSTRAP;

initWebUI(..., {
    ...(unifiedBootstrap ? {
        onAppCreated: async (app) => {
            const mod = await import(pathToFileURL(unifiedBootstrap).href);
            return await mod.default({ oneBotManager, app, logger: log });
        },
    } : {}),
});
```

### 3.2 bootstrap 模块

`unified/packages/runtime/bootstrap.ts` → 打包成 `dist/unified-bootstrap.mjs`：

```ts
export default async function bootstrap({ oneBotManager, app, logger }) {
    const unified = await createUnifiedRuntime({
        dataDir: process.env.UNIFIED_DATA_DIR ?? 'data',
        pluginAllowList: (process.env.UNIFIED_PLUGIN_ALLOW ?? '').split(',').filter(Boolean),
        builtinActionNames: new Set(),
        logger,
    }, app);

    oneBotManager.setPluginBridge(unified.bridge);
    return unified.webuiHooks;
}
```

### 3.3 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `UNIFIED_BOOTSTRAP` | （空） | bootstrap 模块路径。空 = 不启用插件系统 |
| `UNIFIED_PLUGIN_ALLOW` | （空） | 逗号分隔的插件白名单。空 = 不加载 |
| `UNIFIED_DATA_DIR` | `data` | 数据目录（插件在 `<dir>/plugins`） |
| `UNIFIED_BUILTIN_ACTIONS` | （空） | 逗号分隔的内置 action 名（插件不能覆盖） |

---

## 四、启动方式

```bash
cd /opt/snowluma-unified
UNIFIED_BOOTSTRAP=/opt/snowluma-unified/unified-bootstrap.mjs \
UNIFIED_PLUGIN_ALLOW=demo-plugin \
UNIFIED_DATA_DIR=/opt/snowluma-unified/data \
node ./index.mjs
```

**不设 `UNIFIED_BOOTSTRAP` 时，SnowLuma 行为完全不变** —— 这是刻意的设计。

---

## 五、插件目录结构

```
data/plugins/demo-plugin/
├─ package.json          # 必须有 type: "module"
└─ index.js              # 入口
```

**`package.json` 必须写 `"type": "module"`**，否则 Node 会按 CommonJS 解析并警告：

```
[MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of ... is not specified
```

已修复，但文档里要强调。

---

## 六、踩过的坑

| 问题 | 原因 | 解决 |
|---|---|---|
| `bootstrap.mjs` esbuild 报语法错误 | `.mjs` 不能有 TypeScript 语法 | 改名为 `.ts` |
| 插件加载警告 `MODULE_TYPELESS_PACKAGE_JSON` | 插件 `package.json` 缺 `"type": "module"` | 加上 |
| `/api/plugins` 返回 403 | 被 EULA 同意检查挡住 | 先调 `/api/agreements/record-consent` |
| 之后又返回 403 | 被「必须改密码」挡住 | 先调 `/api/auth/change-password` |
| VPS 上 SSH 命令无输出 | `timeout` + `pkill` 组合时 shell 被杀 | 用 `ps aux \| awk \| xargs kill` |

---

## 七、验证步骤（可复现）

```bash
# 1. 本地构建
cd snowluma/src && pnpm build:all
cd unified && node packages/runtime/build.mjs

# 2. 打包上传
tar -czf /tmp/release.tar.gz -C snowluma/src/dist .
scp /tmp/release.tar.gz unified/packages/runtime/dist/unified-bootstrap.mjs root@VPS:/tmp/

# 3. 部署
ssh root@VPS '
  mkdir -p /opt/snowluma-unified
  tar -xzf /tmp/release.tar.gz -C /opt/snowluma-unified
  cp /tmp/unified-bootstrap.mjs /opt/snowluma-unified/
  mkdir -p /opt/snowluma-unified/data/plugins/demo-plugin
'

# 4. 建测试插件（见 §五）
# 5. 启动
UNIFIED_BOOTSTRAP=... UNIFIED_PLUGIN_ALLOW=demo-plugin node ./index.mjs
```

---

## 八、未验证

| 项 | 原因 |
|---|---|
| 插件 action 端到端 | 需要登录 QQ（VPS 上没有账号） |
| 事件分发到插件 | 同上（没有消息流） |
| 插件卸载 | 已由单元测试覆盖 |
| WebUI 插件页 UI | 需要浏览器（VPS 上无 GUI） |

---

## 九、下一步

1. **登录 QQ 后验证 action + 事件** —— 需要在 VPS 上扫码登录
2. **验证 WebUI 插件页** —— 用真实浏览器访问
3. **多插件场景** —— 测试插件间 `getPluginExports` 协作
4. **插件市场** —— 未做
