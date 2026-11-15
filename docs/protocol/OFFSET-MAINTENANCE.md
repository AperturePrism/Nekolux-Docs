# 偏移维护指南（签名扫描替代硬编码偏移表）

> 适用：`unified/packages/native-offsets`
> 建立日期：2026-11-13
> 目的：让 NapCat 的协议层拦截 不再依赖「每个 QQ 版本人工加一行偏移」

---

## 0. 为什么需要这个

NapCat 的 `packages/napcat-core/external/napi2native.json` 长这样：

```json
{
  "9.9.31-49738-x64": { "send": "0AF9FCC", "recv": "2007901" },
  "9.9.36-53644-x64": { "send": "C3EE2F",  "recv": "24A6355" },
  "3.2.34-53644-x64": { "send": "6E5AB20", "recv": "3A12CD0" }
}
```

这是**硬编码 RVA**。问题：

1. QQ 每次小版本更新，偏移就变，必须人工逆向新版本
2. NapCat 官方仓库已于 **2026-11-12 删库**，没人再维护这张表
3. 表里没有的版本，`initHook` 直接 segfault（Linux 3.2.35 实测）

**本方案**：用**函数入口的字节特征**（签名）定位，不存偏移。QQ 升级后只要函数序言不变，签名就继续有效。

---

## 1. 核心事实（实测，2026-11-13）

### 1.1 NapCat 的偏移是 RVA，不是 file offset

Windows QQ `9.9.36-53644`，`核心模块`（117,866,024 B，PE x64）：

| hook | NapCat 表值 | 按 file offset 解释 | 按 RVA 解释（正确） |
|---|---|---|---|
| send | `0xC3EE2F` | `03 48 8d 54 24 28`（函数中间） | `55 41 56 56 57 53 48 83 EC 60`（**函数序言**） |
| recv | `0x24A6355` | `83 c4 28 5b 5f 5e 41 5e c3`（函数尾部） | `55 41 57 41 56 41 55 41 54 56 57 53`（**函数序言**） |

换算公式（`.text` 节 `va=0x1000`、`rawptr=0x400`）：

```
file_offset = RVA - 0xC00
```

> 这个 0xC00 是**本版本**的差值，每个版本/每个节都可能不同，**不要硬编码**。
> 本库的 `binary.ts` 走节表自动换算。

### 1.2 hook 目标是函数入口，正适合签名

按 RVA 解释后，两个点都精确落在标准 x64 函数序言上。这意味着：

- 可以用序言字节做签名
- 序言在同架构编译器下高度稳定（`push rbp` / `push r1x` / `sub rsp` / 栈帧初始化）
- 跨版本会变的只有 `call rel32` / `je rel32` 这类相对位移，用 `??` 通配即可

### 1.3 唯一性实测

| 签名 | 长度 | 全文件命中 |
|---|---|---|
| send | 53 B（含 4 字节通配） | **1** |
| recv | 110 B（含 16 字节通配） | **1** |

recv 前 82 字节有 31 处命中（x64 函数序言高度同质），延伸到 110 字节才唯一。

---

## 2. 使用方法

```bash
cd unified
pnpm install

# 解析（只读）
pnpm resolve-offsets "C:\Program Files\Tencent\QQNT\versions\9.9.36-53644\resources\app\核心模块"

# 机器可读
pnpm resolve-offsets <path> --json
```

输出：

```
file   : 核心模块
size   : 117,866,024
sha256 : 0d8b94448f4dafe7337b88d568b004224c37fcbe2bd1142c1af7624fbd534c
format : pe  arch=x64  imageBase=0x180000000

[HIT] napcat.wrapper.send
      file_offset=0xc3e22f  rva=0xc3ee2f  va=0x180c3ee2f  section=.text
[HIT] napcat.wrapper.recv
      file_offset=0x24a5755  rva=0x24a6355  va=0x1824a6355  section=.text

=> 全部签名命中唯一，可直接用于 hook。
```

**关键**：输出的 `rva` 与 NapCat 静态表**精确一致**（`0xc3ee2f` / `0x24a6355`），
说明签名方案可以无缝替代那张表。

---

## 3. 接入 NapCat

NapCat 的调用点在 `packages/napcat-core/packet/client/nativeClient.ts:47`：

```ts
const success = this.napi2nativeLoader.initHook(send, recv);
```

改造步骤：

```ts
// 改造前
import offsets from '../../external/napi2native.json';
const entry = offsets[`${qqVersion}-${arch}`];
const success = this.napi2nativeLoader.initHook(entry.send, entry.recv);

// 改造后
import { resolve, NAPCAT_HOOK_SIGNATURES } from '@unified/native-offsets';
const data = await readFile(wrapperNodePath);
const result = resolve(wrapperNodePath, data, NAPCAT_HOOK_SIGNATURES);

if (result.failures.length > 0) {
    // 签名失效 → 走 §5 的重新定特征流程
    throw new Error(`hook signature lost: ${result.failures.map(f => f.signatureId)}`);
}

const send = result.sites.find(s => s.signatureId.endsWith('.send'))!;
const recv = result.sites.find(s => s.signatureId.endsWith('.recv'))!;

// NapCat 的 initHook 吃的是 RVA 十六进制字符串
const success = this.napi2nativeLoader.initHook(
    send.rva!.toString(16).toUpperCase(),
    recv.rva!.toString(16).toUpperCase(),
);
```

> **注意**：NapCat 的 `initHook` 接收的是 **RVA 字符串**（不含 `0x`）。
> 用 `site.rva.toString(16)` 即可，**不要**传 `fileOffset`。

---

## 4. 与静态表的关系

**建议保留静态表作为交叉验证**，而不是直接删掉：

```ts
const result = resolve(path, data, NAPCAT_HOOK_SIGNATURES, {
    knownRvas: offsets[versionKey],   // 表里有的版本就校验
});
// result.crossCheck 会告诉你：签名算出的 RVA 与表里的是否一致
```

三种情况：

| 静态表 | 签名 | 处理 |
|---|---|---|
| 有 | 命中 | 交叉验证一致 → 正常；不一致 → **报警**（说明签名匹配到了错误的函数） |
| 有 | 未命中 | 签名失效 → 用表里的值兜底 + 记录待修 |
| 无 | 命中 | **这正是本方案的价值**：新版本自动可用 |
| 无 | 未命中 | 走 §5 |

---

## 5. 签名失效时怎么办

按成本从低到高：

### 5.1 缩短签名（最省事）

签名尾部若落在会变的指令上，去掉尾部即可：

```bash
# 用工具导出当前签名的前 N 字节
# 在新版本里搜，命中后人工确认上下文
```

本库的 `Signature.minPrefixForFallback` 就是给这个用的。

### 5.2 跨版本字节对齐（推荐）

拿**旧版本**命中点附近的一段长字节（±256 B）去**新版本**里搜：

```python
old = open("old_核心模块", "rb").read()
new = open("new_核心模块", "rb").read()
off = 0xC3E22F                    # 旧版本已知 file offset
sig = old[off - 256 : off + 256]  # 512 字节上下文
idx = new.find(sig)
print(hex(idx + 256) if idx >= 0 else "not found")
```

找到后，把新位置周围的字节重新提取成签名。

> 注意：如果函数体本身大改，这段会找不到，走 5.3。

### 5.3 重新逆向（成本最高）

NapCat 的 hook 目标是 MSF 网络层：

- `MSF::MSFSDK::sendPacket` —— 导出符号，`nm -D` 能看到（Linux 版）
- 接收方向函数没有导出符号，需要靠调用关系定位

**Linux 技巧**：`核心模块` 有 885 个导出符号，可以先用 `MSFSDK::sendPacket`
附近的符号作为锚点，再找调用它的内部函数。

**Windows 技巧**：`核心模块` 是 stripped PE，但有 `.pdata` 节（异常处理表），
里面记录了**所有函数的起止地址**——可以用来枚举函数边界，大幅缩小搜索范围。

### 5.4 兜底：手工维护静态表

如果签名彻底失效且来不及逆向，**退回 NapCat 原方案**：手工找偏移填表。
`napi2native.json` 保留原格式，本库可与它共存。

---

## 6. 平台差异

| 平台 | 核心模块 格式 | 现状 |
|---|---|---|
| Windows | PE x64 | ✅ 已验证（9.9.36-53644，napi send/recv + packet send/recv 各唯一命中，与 fork 表逐字节一致） |
| Linux | ELF x64 | ✅ **跨版本已验证**：3.2.28-48517 与 3.2.35-54395 上 napi send + packet send/recv 三组签名均唯一命中，与 fork 表值一致（详见下表） |
| macOS | Mach-O | ❌ 未涉及 |

### 6.1 Linux 跨版本验证矩阵（2026-11-15）

拿两个真实二进制逐字节验证（3.2.28 是 NAS 生产环境版本，3.2.35 是实验环境版本）：

| 签名 | 3.2.28-48517 | 3.2.35-54395 | 跨版本稳定 |
|---|---|---|---|
| `napcat.wrapper.send.linux` | ✅ 0x5E41890 | ✅ 0x6EBE4D0 | ✅ |
| `napcat.packet.send.linux` | ✅ 0x56BE140 | ✅ 0x665CC80 | ✅ |
| `napcat.packet.recv.linux` | ✅ 0x56BFE90 | ✅ 0x665EA20 | ✅ |
| ~~`napcat.wrapper.recv.linux`~~ | ❌ | ❌ | **已移除**（见 6.2） |

> 3.2.28 的 napi send 解析值 0x5E41890 与 fork `napi2native.json` 的
> `3.2.28-48517-x64.send` **精确一致**，跨版本可信度得到交叉印证。

### 6.2 为什么没有 napi recv 的 Linux 签名

该函数属于 djinni 生成的分发器家族，**全二进制有 269 个函数共享同一段序言**
（只有 `sub rsp` 的立即数和 `je` 位移不同）。实测四种方案全部失败：

| 方案 | 3.2.28 | 3.2.35 |
|---|---|---|
| 短序言 + FDE 入口约束 | 269 命中 | 269 命中 |
| 再排除已解析的 send 位置 | 仍多命中 | 仍多命中 |
| 300 字节长合并签名 | **0 命中** | 22 命中（不唯一） |
| 两版字节取交集通配 | 678 命中 | 165 命中 |

根因：两版之间编译器把栈帧从 0x40 改成 0x30，**所有 `[rsp+N]` 引用整体平移**，
长签名逐字节全错；而短签名又不足以区分 269 个同族函数。

**影响：无**。packet 层签名经流量验证可覆盖收发需求；napi recv 另有零账号实验
证实登录页 0 流量（`reports/X64-CODEC-ALIVE-EXPERIMENT.md` §九）。
若将来确实需要它，正确做法是**按版本写死表值**（NapCat 的做法），
因为该函数的可辨识特征恰好是版本相关的。

**Linux 签名的两个特有机制**（Windows PE 不需要）：

1. **`.eh_frame_hdr` FDE 函数入口约束**（`requireEhFrameEntry: true`）——GCC 布局下函数背靠背，
   PE 的「前一字节是 ret/int3」启发式在 ELF 上不可靠；FDE 二分表给出真函数入口。
   recv 同族分发函数（序言相同的多个同构体）只有靠这条约束才能收敛到唯一命中。
2. **packet 表值 ×2 编码**（`tableEncoding: 'rva-x2'`）——`packet.json` 的表值是真实偏移 ×2
   （MoeHoo InitHook 对入参 `>>1`），`napi2native.json` 直接存 RVA。解析结果的
   `tableValue` 字段已按编码输出，不要再手工换算。

集成测试（真实二进制，环境变量门控，缺省跳过）：

```bash
# Windows PE（117MB）
UNIFIED_WRAPPER_NODE="C:\Program Files\Tencent\QQNT\versions\<版本>\resources\app\核心模块"
# Linux ELF x64（152MB，3.2.35-54395）
UNIFIED_LINUX_WRAPPER_NODE="<本机路径>\核心模块"
```

---

## 7. 设计约束（不要违反）

1. **不要把 file offset 写进签名表**。存的是字节特征，不是地址。
2. **不要用通配符掩盖不确定的部分**。通配只用于「语义上已知会变」的字段
   （rel32 位移、地址常量）。通配太多会让签名在无关函数上误命中。
3. **命中数必须为 1**。多于 1 时本库直接报 `ambiguous`，不猜。
4. **不要跳过交叉验证**。静态表存在时一定要比对，否则签名匹配到错误函数时无感知。
5. **签名要带注释**。每条签名都要写清楚它对应哪个函数、哪些字节是通配、为什么。

---

## 8. 文件索引

| 路径 | 角色 |
|---|---|
| `packages/native-offsets/src/signature.ts` | 通配符签名的解析与扫描 |
| `packages/native-offsets/src/binary.ts` | PE/ELF 解析 + 三套坐标换算 + `.eh_frame_hdr` FDE 表 |
| `packages/native-offsets/src/resolver.ts` | 解析主流程 + 交叉验证 + eh_frame 入口约束 + 表值编码 + sha256 |
| `packages/native-offsets/src/signatures/napcat-hooks.ts` | **napi 签名库**（Windows PE + Linux ELF x64 send/recv） |
| `packages/native-offsets/src/signatures/packet-hooks.ts` | **packet 签名库**（MoeHoo 收发监听，表值 ×2 编码） |
| `packages/native-offsets/tests/` | 单元测试 + 真实二进制集成测试（PE + ELF） |
| `tools/resolve-offsets.ts` | CLI（自动按容器格式/架构筛选签名） |

---

## 9. 参考：LLQQNT 的同类方案

`D:\Project\nc+sl\LLQQNT\tools\verify-bypass\` 用同样的思路解决**另一个问题**
（QQ 文件校验绕过）。两者的对比：

| 维度 | LLQQNT（文件校验） | 本库（NapCat hook） |
|---|---|---|
| 目标 | 校验函数里的 `call memcmp` | MSF 网络层函数入口 |
| 签名长度 | 18 B（x64） | 53 B / 110 B |
| 通配 | 无（全确定字节） | 有（rel32 位移） |
| 为什么通配 | 目标指令本身固定 | 函数序言里的 call 目标会变 |
| 命中数 | 1 | 1 |
| 跨版本 | 9.9.32 → 9.9.36 四个版本不用改 | 待验证（只有单版本实测） |

LLQQNT 那份 `OFFSET-RESOLUTION.md` 的 §10「sig 失效时怎么重新定特征」
可以直接套用到这里，方法论一致。

---

## 10. 已知限制

1. **只有单版本实测**。签名在 9.9.36-53644 唯一命中，但没有第二个版本的
   `核心模块` 做跨版本验证。真正证明「跨版本稳定」需要拿到 9.9.35 或
   9.9.37 的二进制跑一遍。
2. **Linux 签名未采集**。当前只有 Windows。
3. **`requireEntry` 字段未实现**。签名库里有这个字段，但 `resolver.ts`
   还没用它做「命中点必须是函数入口」的额外校验（目前靠签名长度保证特异性）。
4. **没有处理函数被内联/拆分**。如果 QQ 重构把 send/recv 拆成多个函数，
   签名会失效，必须走 §5.3。
