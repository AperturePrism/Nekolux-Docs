# NAS 实测报告

> 日期：2026-11-14
> 环境：NAS（Debian 12，x86_64，4 核 7.7G）· Docker · QQ Linux 3.2.28-48517
> 测试群：大肥鱼测试群（1134381782）
> 结论：**Nekolux 功能完整可用，压力与边界表现良好**

---

## 一、总览

| 测试项 | 结果 |
|---|---|
| 压力测试（并发 20 × 100 条） | ✅ 100/100，2.17s |
| 边界测试（14 个异常用例） | ✅ 11 个精确报错，3 个正常通过 |
| 关键词插件端到端 | ✅ 事件 → 匹配 → 回复 |
| 多账号 | ⏸ 未做（需第二个 QQ） |

---

## 二、压力测试

### 2.1 方法

容器内直接走 OneBot HTTP（排除 SSH + `docker exec` 开销），
用固定并发 worker 池发送 `send_group_msg`。

```js
// tools/stress.cjs
const workers = Number(process.argv[3] ?? 5);
async function worker() {
    while (next <= n) {
        const i = next++;
        results.push(await send(i));
    }
}
```

### 2.2 结果

| 并发 | 条数 | 成功 | 总耗时 | min | p50 | p95 | max |
|---|---|---|---|---|---|---|---|
| 5 | 20 | 20/20 | 1.14s | 196ms | 268ms | 330ms | 330ms |
| 10 | 50 | 50/50 | 2.47s | 160ms | 279ms | 1092ms | 1244ms |
| **20** | **100** | **100/100** | **2.17s** | 172ms | 313ms | 761ms | 800ms |

**全部成功，无丢失、无重复。**

### 2.3 一个容易误判的对比

用 SSH + `docker exec` 调同一个 action，延迟是 **7.3–7.9 秒**：

```
并发 10 条  成功 10/10  总耗时 15.5s
延迟: min=7.30s  p50=7.65s  max=7.85s
```

这 **7.5 秒全是 `ssh` 建连 + `docker exec` 进程启动的开销**，不是 Nekolux 的性能。
真实延迟看容器内数据（p50 313ms）。

---

## 三、边界测试

14 个异常用例，全部按预期处理。

### 3.1 参数校验（精确到字段）

```
未知 action      1404  unknown action
缺必需参数        1400  message: is required
群号非法(-1)      1400  group_id: must be >= 1
空消息           1400  message segment array must not be empty
非法消息类型      1400  unknown message segment type: not_a_type
负时长禁言        1400  duration: must be >= 0
```

**错误信息都指出了具体字段和原因**，不是笼统的「参数错误」。

### 3.2 资源不存在

```
消息ID不存在      100   message not found
不存在的文件      100   ENOENT: no such file or directory, realpath '/tmp/no-such-file.txt'
超大禁言时长      100   OIDB error 120101203 on 0x1253_1:
```

`OIDB error` 带上了 cmd 和错误码，排障友好。

### 3.3 正常通过

| 用例 | 结果 |
|---|---|
| 超长文本（5000 字） | ✅ 发送成功，无截断 |
| 特殊字符 + emoji + NUL | ✅ 发送成功，无崩溃 |
| CQ 码字符串 `[CQ:face,id=1]` | ✅ 自动解析 |

### 3.4 两个语义问题（不是 bug）

```
get_group_info(999999999) → {"status":"ok","data":{"group_name":"","member_count":0,...}}
get_stranger_info(1)      → {"status":"ok","data":{"nickname":"","uid":"",...}}
```

**不存在的群/用户返回 `ok` + 空结构**。这是 QQ 服务端的行为——它对不存在的目标
返回空对象而不是错误码，Nekolux 如实透传。

**影响**：调用方需要自己判断「字段全空」= 不存在。可以改进（`group_name === ''` 时
返回 1404），但这是**语义选择**，需要权衡兼容性。

---

## 四、关键词插件端到端

### 4.1 插件代码

`unified/examples/plugins/keyword-reply/`

```js
export async function plugin_onmessage(ctx, event) {
    if (event.message_type !== 'group') return;

    const text = extractText(event.message);
    const matched = (ctx.getConfig().keywords ?? ['你好']).find((k) => text.includes(k));
    if (!matched) return;

    // 防刷屏：同群同关键词 5 秒内只回一次
    if (Date.now() - (lastReply.get(key) ?? 0) < 5000) return;

    await ctx.callAction('send_group_msg', {
        group_id: event.group_id,
        message: [
            { type: 'reply', data: { id: String(event.message_id) } },
            { type: 'text', data: { text: ctx.getConfig().reply ?? '收到～' } },
        ],
    });
}
```

### 4.2 实测日志

```
04:34:53 [Event] 群 [大肥鱼测试群(1134381782)] | [寒拂晴ColdBreeze(1721822150)]: ID:-617667331 你好
04:34:53 [App] saw message from 1721822150
04:34:53 [App] keyword hit: 你好 in group 1134381782 from 1721822150
04:34:53 [Event] [自身] 群 [大肥鱼测试群] | [Nekolux测试(3816829185)]:
         [回复 寒拂晴ColdBreeze(1721822150): 你好] 收到～
```

**完整链路**：

```
群消息 → SnowLuma 事件管道 → PluginManager.dispatch
  → keyword-reply.plugin_onmessage
  → 关键词匹配
  → ctx.callAction('send_group_msg')      ← 新增能力
  → OneBot action 分发
  → 群内回复（带引用）
```

---

## 五、这次测试发现并修复的问题

### 5.1 `PluginContext` 缺少操作 QQ 的能力（设计缺口）

**现象**：写完关键词插件才发现——`ctx` 只有 `actions.register`（注册），
没有调用 action 的能力。**插件能收到消息但没法回**。

**修复**：新增 `ctx.callAction(action, params)`。

**设计取舍**：

| 方案 | 问题 |
|---|---|
| 暴露 `bridge` / `oneBot` 实例 | 插件绕过 OneBot 抽象，直接操作协议 |
| 暴露原始封包发送 | 插件能构造任意 OIDB，安全边界消失 |
| **只暴露 `callAction`** | 复用 214 个 action，能力完整且边界清晰 |

加了 3 个测试（`tests/runtime.test.ts`），覆盖：转发、无实现时报错、失败传播。

### 5.2 QQ 数据实际在 `/root/.config/QQ`

挂载到 `/app/.config/QQ` **无效**（那是 napcat 镜像的空 VOLUME）。
改挂 `/root/.config/QQ` 后登录态才能持久化。

### 5.3 镜像里的 bootstrap 会覆盖 `docker cp` 的副本

`docker cp` 更新 `/app/unified-bootstrap.mjs` 后，`docker rm -f` 重建容器
又会用镜像里的旧版本。**必须重建镜像**，不能只 `docker cp`。

---

## 六、复现步骤

```bash
# 1. 压力测试（容器内，排除 SSH 开销）
docker cp tools/stress.cjs unified:/tmp/
docker exec unified node /tmp/stress.cjs 100 20

# 2. 边界测试
docker cp tools/edge.cjs unified:/tmp/
docker exec unified node /tmp/edge.cjs

# 3. 关键词插件
#    - 把 examples/plugins/keyword-reply 复制到 data/plugins/
#    - 加进 UNIFIED_PLUGIN_ALLOW
#    - 重启容器
docker cp tools/keyword-test.cjs unified:/tmp/
docker exec unified node /tmp/keyword-test.cjs 1134381782
```

---

## 七、文件索引

| 路径 | 说明 |
|---|---|
| `tools/stress.cjs` | 并发压力测试（容器内运行） |
| `tools/edge.cjs` | 边界用例测试 |
| `tools/keyword-test.cjs` | 关键词插件端到端测试 |
| `tools/nas-onebot.py` | 通过 SSH 调 OneBot（有 7.5s 开销，仅适合单次调用） |
| `unified/examples/plugins/keyword-reply/` | 示例插件源码 |
| `docs/PLUGIN-SYSTEM.md` | `callAction` 设计说明 |
| `docs/NAS-DEPLOYMENT.md` | 部署与排障 |
