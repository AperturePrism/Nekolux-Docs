# NAS 部署验收报告：戳一戳撤回 + get_supported_actions

> 日期：2026-11-15
> 环境：NAS（10.40.23.191）· Docker · unified 容器 · QQ Linux 3.2.35-54395 · 运行时 v2.4.2
> 账号：3816829185（生产号，用户自行完成 VNC 登录）
> 结论：**三项全部通过**——灰条撤回在真实环境闭环

---

## 一、部署内容

| 项 | 值 |
|---|---|
| 镜像 | `unified:local`（新构建 `8f2de933`，运行 `c97278e8`/当前 `Up`） |
| 运行时 | v2.4.2，Node v24.22.1，`index.mjs` 12,456,207 B |
| 新增能力 | 戳一戳灰条撤回（`msgSeq` 全链路）+ `get_supported_actions` |
| 内置 action | **234 个**（启动日志 `builtin action names: 234`） |
| 日志级别 | `NEKOLUX_LOG_LEVEL=trace`（为验收需要，可回调为 debug） |

## 二、验收结果

### 2.1 登录与 action 存在性

```json
get_login_info  → {"user_id":3816829185,"nickname":"沈知意"}
get_supported_actions → 234 项，含：
  ".send_packet" / "send_packet" / "delete_msg" / "group_poke" / "get_supported_actions"
```

### 2.2 普通消息撤回（基线）

```
send_group_msg → message_id:-845545365
delete_msg     → retcode 0
```

### 2.3 **戳一戳灰条撤回（本次核心交付）**

事件体（trace 级别直接输出完整 JSON）：

```json
{ "time":1794712626, "self_id":3816829185, "post_type":"notice",
  "notice_type":"notify", "sub_type":"poke", "group_id":1134381782,
  "user_id":3816829185, "target_id":1721822150,
  "action":"揉了揉", "suffix":"的头",
  "action_img_url":"http://tianquan.gtimg.cn/nudgeaction/item/8/expression.jpg",
  "message_id":-954029912 }
```

关键字段 `message_id` 由 `msgSeq` 全链路派生：
`event-0x2dc.ts` 取 `ctx.head.sequence` → `handleGroupPoke` 缓存 meta
→ `to-notice.ts:154` 条件附加 `fields.message_id`。

撤回与**服务端确认**：

```
packet_send  SsoGroupRecallMsg  body=080110d695f59c041a0408a596022200  (16B)
packet_recv  SsoGroupRecallMsg  error=0  elapsedMs=201
Bridge       packet SsoGroupRecallMsg ok (16B⇄0B, 202ms)
packet_push  SsoGroupRecallMsg  seqId=3012924 retCode=0   ← 服务端回推撤回确认
response={status:"ok",retcode:0,data:null}
```

`seqId=3012924` 即该灰条的群序列号（与缓存的 msgSeq 一致），服务端回推 `retCode=0`
证明群里那条戳一戳灰条已被真实撤回。

## 三、复现

```bash
export NAS_PASS='<nas sudo 密码>'
cd unified/tools/nas && bash nas-acceptance.sh
```

脚本覆盖：登录态 / 关键 action / 普通消息撤回 / 戳一戳事件体 / 灰条撤回 / 服务端确认。
注意 `message_id` 可为负数（int32 哈希），解析正则必须带符号。

## 四、验收中踩的坑

| 现象 | 原因 | 结论 |
|---|---|---|
| OneBot 3000/3001 不监听 | 适配器等 QQ 登录后才启动 | 登录后 1 秒内监听 |
| 配置文件写 3200/3201，实际 3000/3001 | 容器内配置与宿主端口映射不同层 | 以运行日志 `listening 0.0.0.0:3000` 为准 |
| WS 客户端连不上 3001 | 容器内 node 的 WS 握手不被接受（多 token/role 尝试均失败） | 改用 `NEKOLUX_LOG_LEVEL=trace` 从日志取事件体，更直接 |
| `get_group_msg_history` 为空 | 灰条不入消息历史 | 只能靠事件流观察 |
| 容器重启后需重新登录 | 会话未跨容器自动恢复 | 每次换镜像要 VNC 重新登录 |

## 五、已知遗留

1. **`Client private-message reporting is unavailable`（status=-1）**：登录过程中出现的 WARN，
   双人测试群下不影响功能；待后续在多人场景观察是否影响私聊消息上报
2. **日志级别**：当前容器为 `trace`（验收需要）。生产建议改回 `debug`，
   否则包级 TRACE 会持续刷盘
3. **`demo-plugin` 警告**：entrypoint 默认允许列表仍含已不存在的插件名，
   已在 `nas-run-unified.sh` 内联命令中修正为 `keyword-reply`，
   entrypoint 默认值待同步修正
