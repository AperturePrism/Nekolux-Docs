# Linux 签名：已完成（2026-11-16 更新）

> **本文档已重写。** 早期版本（2026-11-13）记录的是「签名采集受阻，需要 QQ 账号登录」——
> 那个结论**已被推翻**，原因有二：
>
> 1. 「卡在登录」这个阻塞点不存在：**零账号 uprobe 实验**用登录页自主流量就验证了 codec 层存活
> 2. 「Linux 3.2.35 封包 hook 架构失效」也是误读（见 [LINUX-HOOK-INVESTIGATION](/protocol/LINUX-HOOK-INVESTIGATION) §十）
>
> 当前状态：**Linux 签名已整合、跨版本验证通过、生产环境在用。**

---

## 一、结论

| 签名 | 3.2.28-48517 | 3.2.35-54395 | 状态 |
|---|---|---|---|
| `napcat.wrapper.send.linux`（napi send） | ✅ 0x5E41890 | ✅ 0x6EBE4D0 | 跨版本稳定 |
| `napcat.packet.send.linux` | ✅ 0x56BE140 | ✅ 0x665CC80 | 跨版本稳定 |
| `napcat.packet.recv.linux` | ✅ 0x56BFE90 | ✅ 0x665EA20 | 跨版本稳定 |
| ~~napi recv~~ | ❌ | ❌ | **已移除**（见 §四） |

三方交叉印证：

1. **签名解析** → 上述地址
2. **fork 静态表** → `napi2native.json` / `packet.json` 的 `3.2.28-48517-x64` 与 `3.2.35-54395-x64` 条目
3. **内核 uprobe 实测** → packet send/recv 在登录页 7 分钟内各命中 39 次、严格 39:39 对称

三者完全一致。

---

## 二、关键方法

### 2.1 定位 hook 点：签名 + `.eh_frame_hdr` 约束

- 用**函数序言的字节特征**定位，`??` 通配跨版本会变的 rel32 位移
- 用 **`.eh_frame_hdr` FDE 表**校验命中点是否为真函数入口（GCC 布局下函数背靠背，
  「前一字节是 ret」的启发式不可靠）
- 3.2.35 的 FDE 表有 **322,547** 个函数入口，3.2.28 有 **279,382** 个

### 2.2 验证存活：零账号内核 uprobe

不需要登录 QQ。登录页本身就在发心跳 / o3 遥测 / 二维码轮询，用 `tracefs` 挂被动探针即可：

```bash
# 注意：MEMADDR 是**文件偏移**，不是 vaddr（wrapper.node RX 段差 0x1000）
echo 'p:uprobes/codec_send /path/wrapper.node:0x000000000665bc80' >> /sys/kernel/tracing/uprobe_events
echo 'p:uprobes/codec_recv /path/wrapper.node:0x000000000665da20' >> /sys/kernel/tracing/uprobe_events
```

结果：7 分钟窗口内 send/recv 各 39 次，**严格 1:1 对称**（请求/响应配对）。
完整实验见 [X64-CODEC-ALIVE-EXPERIMENT](/reports/X64-CODEC-ALIVE-EXPERIMENT)。

### 2.3 packet 表值的 ×2 编码

`packet.json` 存的是**真实偏移 × 2**（MoeHoo 的 InitHook 对入参 `strtoull` 后各做一次 `>>1`），
而 `napi2native.json` 直接存 RVA。解析库用 `tableEncoding: 'rva-x2'` 区分。

---

## 三、跨版本稳定性

两个真实二进制逐字节验证（3.2.28 是 NAS 生产版本，3.2.35 是实验版本）：

- 两版之间编译器把 recv 的栈帧从 `0x40` 改成 `0x30`，**所有 `[rsp+N]` 引用整体平移**
- send 类签名不受影响（不含栈槽引用），recv 的长签名因此失效

**教训**：签名里尽量不包含栈槽偏移；确实需要时用 `.eh_frame_hdr` 入口约束兜底。

---

## 四、为什么没有 napi recv 的签名

该函数属于 djinni 生成的分发器家族，**全二进制有 269 个函数共享同一段序言**：

```
push r15; push r14; push rbx; sub rsp, imm8
mov r15, [rdi+0x10]; cmp qword [r15+0x20], 0; je rel32
```

只有 `sub rsp` 的立即数和 `je` 位移不同。四种方案实测全部失败：

| 方案 | 3.2.28 | 3.2.35 |
|---|---|---|
| 短序言 + FDE 入口约束 | 269 命中 | 269 命中 |
| 再排除已解析的 send 位置 | 仍多命中 | 仍多命中 |
| 300 字节长合并签名 | **0 命中** | 22 命中（不唯一） |
| 两版字节取交集通配 | 678 命中 | 165 命中 |

**影响：无**。packet 层签名经流量验证可覆盖收发需求；napi recv 另有零账号实验
证实登录页 0 流量。若将来确实需要，正确做法是**按版本写死表值**（NapCat 的做法），
因为该函数的可辨识特征恰好是版本相关的。

---

## 五、维护

签名失效时的流程见 [OFFSET-MAINTENANCE](/protocol/OFFSET-MAINTENANCE)。
核心原则：

1. 命中数必须为 1，多于 1 报 `ambiguous` 而不是猜
2. 必须与 fork 静态表交叉验证
3. 必须经真实流量验证才能当作 hook 点
4. 尽量不把栈槽偏移写进签名

---

## 六、相关文档

- [LINUX-HOOK-INVESTIGATION](/protocol/LINUX-HOOK-INVESTIGATION) —— 架构分层与结论修正
- [OFFSET-MAINTENANCE](/protocol/OFFSET-MAINTENANCE) —— 签名维护全流程
- [PACKET-HOOK-INTEGRATION](/protocol/PACKET-HOOK-INTEGRATION) —— 自研注入器与 hook 模块
- [X64-CODEC-ALIVE-EXPERIMENT](/reports/X64-CODEC-ALIVE-EXPERIMENT) —— 决定性实验原始报告
