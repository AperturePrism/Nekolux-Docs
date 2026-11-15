# NapCat 偏移逆向（独立保留）

> 本目录保留 NapCat 原有的「逆向新 核心模块 算出偏移」能力。
> 它与 `packages/native-offsets` 的签名方案**并存**，不是替代关系。

---

## 为什么两套都要

| | 签名扫描（native-offsets） | 偏移逆向（本目录） |
|---|---|---|
| 输入 | 二进制 + 字节特征 | 二进制 + 已知锚点 |
| 输出 | 函数位置 | 函数位置 |
| 需要特征吗 | 需要 | 不需要 |
| 失效场景 | 函数序言变了 | 找不到锚点 |
| 适用 | 常规升级 | 签名失效、函数大改 |

**签名是首选**：QQ 小版本升级时函数序言通常不变，签名继续有效。

**逆向是兜底**：如果 QQ 重构把 send/recv 拆了或改了序言，签名会失效，
这时必须回到逆向。

---

## 一、Windows（PE）

### 1.1 环境

```
QQ: C:\Program Files\Tencent\QQNT\versions\<ver>\resources\app\核心模块
工具: IDA Pro / Ghidra（任一）
```

### 1.2 方法 A：导出符号锚点（推荐，快）

Windows 的 `核心模块` 是 stripped PE，但有 885 个**动态导出符号**：

```bash
# 用 dumpbin（VS 自带）或 Python pefile 列出导出
dumpbin /exports 核心模块 | grep -i "MSF"
```

已知有用的符号：

```
_ZN3MSF6MSFSDK10sendPacketENSt2Cr10unique_ptrINS_10MSFRequestENS1_14default_deleteIS3_EEEE
_ZN3MSF6MSFSDK12cancelPacketEi
_ZN3MSF6MSFSDK16getNextPacketSeqEv
_ZN3MSF6MSFSDK13sendQueueSizeEv
_ZN3MSF6MSFSDK13recvQueueSizeEv
```

**send 方向的 hook 点**：实测 `0xC3EE2F`（RVA）就是 `MSFSDK::sendPacket` 入口附近。
可以用这些导出符号做锚点，在其附近搜索函数序言。

**recv 方向**没有导出符号，需要用调用关系找：在 IDA 里看谁调用了
`sendPacket` 所在的类/命名空间，接收方向通常在同一个类里。

### 1.3 方法 B：.pdata 节枚举函数边界（强烈推荐）

PE 的 `.pdata` 节（异常处理表）记录了**所有函数的起止地址**：

```
.pdata 条目（12 字节）：
  +0  BeginAddress (RVA, 4B)
  +4  EndAddress   (RVA, 4B)
  +8  UnwindInfo   (RVA, 4B)
```

这能把 117MB 的搜索空间缩小到「函数入口列表」。做法：

1. 解析 `.pdata`，得到所有函数起始 RVA
2. 只在这些地址上尝试签名匹配（而不是全文件扫描）
3. 如果签名命中数仍 > 1，用 `UnwindInfo` 里的**栈帧大小**进一步区分

> 本项目的 `native-offsets` 目前是**全文件扫描**。如果你遇到签名歧义，
> 把 `.pdata` 枚举加进去是最有效的优化。

### 1.4 方法 C：完整逆向（最后手段）

1. IDA 载入 `核心模块`（体积极大，全量分析要几小时）
2. 找 `MSF` 相关的字符串交叉引用
3. 在 `sendPacket` / 接收函数的入口下断点
4. 确认参数签名（send 通常是 `(this, unique_ptr<MSFRequest>)`）
5. 记录 RVA

### 1.5 坐标换算（关键）

**NapCat 的表存 RVA，不是 file offset。** 换算走节表：

```
file_offset = 节.PointerToRawData + (RVA - 节.VirtualAddress)
```

实测 9.9.36-53644：

```
.text: VirtualAddress=0x1000, PointerToRawData=0x400
→ file_offset = RVA - 0xC00
```

**不要硬编码 0xC00**，每个版本可能不同。用 `native-offsets` 的 `rvaToOffset()`。

---

## 二、Linux（ELF）

### 2.1 环境

```
QQ: /opt/QQ/resources/app/核心模块
当前实测版本: 3.2.35-54395（152,431,496 B，ELF64 x64，stripped）
```

### 2.2 导出符号（比 Windows 好用）

Linux 版有 **885 个动态符号**，包括完整的 MSF 命名空间：

```bash
nm -D /opt/QQ/resources/app/核心模块 | grep "MSF"
```

```
000000000670dd20 T _ZN3MSF6MSFSDK10sendPacketENSt2Cr10unique_ptrINS_10MSFRequestENS1_14default_deleteIS3_EEEE
000000000670dee0 T _ZN3MSF6MSFSDK12cancelPacketEi
000000000670ed90 T _ZN3MSF6MSFSDK12isPullIpOverEv
000000000670ee00 T _ZN3MSF6MSFSDK14clearSendQueueEv
000000000670fd80 T _ZN3MSF6MSFSDK12currentSSOIPEv
000000000670ffb0 T _ZN3MSF6MSFSDK11getApnStateEv
0000000006710010 T _ZN3MSF6MSFSDK11getClientIPEv
00000000067105b0 T _ZN3MSF6MSFSDK13sendQueueSizeEv
00000000067105d0 T _ZN3MSF6MSFSDK13recvQueueSizeEv
0000000006710610 T _ZN3MSF6MSFSDK16sendMSFPingCheckEi
```

**注意**：这些符号的地址（如 `0x670dd20`）是 **VA**（ELF 的 `st_value`），
不是 NapCat 表里的 RVA 格式。NapCat 的 Linux 表用的是**另一套偏移**
（实测 3.2.34-53644 的 send 是 `0x6E5AB20`，与 `sendPacket` 的 `0x670dd20` 不同）。

说明 NapCat hook 的**不是** `MSFSDK::sendPacket` 本身，而是它上层/下层的某个内部函数。
`sendPacket` 可以作为**锚点**：在它附近搜索调用链。

### 2.3 方法：符号锚点 + 邻域搜索

```bash
# 1. 找 sendPacket 的 VA
nm -D 核心模块 | grep "MSFSDK10sendPacket"
# → 0x670dd20

# 2. 转成 file offset
#    ELF: file_offset = sh_offset + (VA - sh_addr)
#    本版本 .text: sh_addr=0x?, sh_offset=0x?
readelf -S 核心模块 | grep -A1 "\.text"

# 3. 在 sendPacket 附近（±1MB）搜索函数序言
# 4. 用 NapCat 已知的 3.2.34 偏移做交叉验证（如果拿得到旧版本二进制）
```

### 2.4 Linux 现状（2026-11-13）

| 项 | 状态 |
|---|---|
| QQ 版本 | 3.2.35-54395 |
| NapCat 表最新 | 3.2.34-53644 |
| 直接套用旧偏移 | ❌ segfault |
| 导出符号可用 | ✅ 885 个 |
| 签名已采集 | ❌ 待做 |

**下一步**：用 §2.3 的方法定位 3.2.35 的 send/recv，然后按
`packages/native-offsets/src/signatures/napcat-hooks.ts` 的格式生成签名。

---

## 三、macOS（Mach-O）

未涉及。`核心模块` 应该是 Mach-O 格式，`nm -gU` 可以列符号。

---

## 四、与 native-offsets 的协作

```
┌─────────────────────────────────────────────┐
│  QQ 升级了                                   │
└─────────────────┬───────────────────────────┘
                  ↓
      ┌───────────────────────┐
      │ 跑 native-offsets CLI │
      │ pnpm resolve-offsets  │
      └───────────┬───────────┘
                  ↓
        ┌─────────┴─────────┐
        │                   │
     命中唯一             未命中/歧义
        │                   │
        ↓                   ↓
   直接可用          ┌──────────────┐
   （最常见）        │ 本目录的逆向 │
                    │ 方法 A/B/C   │
                    └──────┬───────┘
                           ↓
                    ┌──────────────┐
                    │ 更新签名表   │
                    │ 或填静态表   │
                    └──────────────┘
```

---

## 五、工具清单

| 工具 | 用途 | 平台 |
|---|---|---|
| `nm -D` | 列 ELF 动态符号 | Linux |
| `readelf -S` | 列 ELF 节表 | Linux |
| `dumpbin /exports` | 列 PE 导出 | Windows |
| IDA Pro / Ghidra | 完整逆向 | 全平台 |
| `../packages/native-offsets` | 签名解析 | 全平台 |
| `../tools/resolve-offsets.ts` | CLI | 全平台 |

---

## 六、实测数据（供参考）

### Windows 9.9.36-53644

| hook | NapCat RVA | file offset | 序言长度 | 签名唯一性 |
|---|---|---|---|---|
| send | `0xC3EE2F` | `0xC3E22F` | 53 B | 1 |
| recv | `0x24A6355` | `0x24A5755` | 110 B | 1 |

### Linux 3.2.34-53644（NapCat 表里的值）

| hook | NapCat 偏移 |
|---|---|
| send | `0x6E5AB20` |
| recv | `0x3A12CD0` |

> Linux 的偏移格式与 Windows 不同（不是 RVA-0xC00 这种关系），
> 需要单独确认是 file offset 还是 VA。

---

## 七、注意事项

1. **不要用 offset 做输入**。一旦把 file offset 硬编码，就退化回人工维护模式。
2. **优先用签名**。本目录的逆向只在签名失效时使用。
3. **`.pdata` 是被低估的工具**。Windows PE 的函数边界信息能大幅缩小搜索范围。
4. **Linux 符号表比 Windows 友好**。`nm -D` 直接能看 MSF 命名空间。
5. **记录每次逆向的结果**。即使填的是静态表，也把二进制 sha256 记下来，
   下次遇到同版本能直接复用。
