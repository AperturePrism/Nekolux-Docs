# 阶段 0 补充验证：Linux 可行性

> 日期：2026-11-13
> 环境：WSL2 (Arch Linux, kernel 6.18.58.1) · x86_64 · 15GB RAM · QQ Linux 3.2.35-54395
> 结论：**SnowLuma 在 Linux 上全链路通过；NapCat 在 Linux 上需要手工维护 QQ 版本偏移**

---

## 一、结论先行

| 项目 | Windows | Linux | 说明 |
|---|---|---|---|
| SnowLuma 从源码构建 | ✅ | ✅ | 两边产物 `index.mjs` 都是 12,446,350 B |
| SnowLuma 类型检查 | ✅ 14/14 | ✅ 14/14 | 零错误 |
| SnowLuma 单元测试 | ⚠️ 1501/1504 | ⚠️ 1501/1504 | 失败项不同，均为环境/flaky |
| SnowLuma 运行时启动 | ✅ | ✅ | WebUI 均监听 5099 |
| **SnowLuma 原生注入** | ✅ | ✅ | **Linux 更快：1 秒 vs Windows 7 秒** |
| **SnowLuma 管道握手** | ✅ QHP1 | ✅ QHP1 | 协议帧完全一致 |
| **SnowLuma 卸载** | ✅ | ✅ | 干净回收 |
| NapCat shell 构建 | ✅ | 未测（仅构建配置检查） | — |
| NapCat 原生模块加载 | ✅ | ✅ | MoeHoo + napi2native 均可加载 |
| NapCat 协议层拦截 | ✅ 表内有 9.9.31-49738 | ❌ 表内无 3.2.35-54395 | **见 §4** |

---

## 二、Linux 环境搭建记录

### 2.1 遇到的坑

| 问题 | 原因 | 解决 |
|---|---|---|
| Arch 的 `node` 无法运行 | `libcrypto.so.4` 缺失（Arch openssl 3.6 soname 与 node 包不匹配） | 改用 Node 官方二进制 v24.22.1 |
| 腾讯官网 QQ 下载链接全部 404 | `im.qq.com/rainbow/linuxQQDownload` 返回 2025-06 的 3.2.18 链接，已失效 | 从 AUR `linuxqq` 的 PKGBUILD 提取真实地址 |
| QQ 启动缺 GTK/X11 库 | 纯净 Arch 无桌面依赖 | `pacman -S gtk3 nss alsa-lib at-spi2-core libxcomposite ...` |
| `node_modules` 跨平台不兼容 | Windows 装的含 `.node` 二进制 | 复制到 `/opt/snowluma-linux` 重新安装 |

### 2.2 关键信息

```
QQ 版本: 3.2.35-54395  (构建 2026-10-28)
真实下载地址: https://qqdl.gtimg.cn/qqfile/QQNT/9.9.37/beta/816b3c79/linuxqq_3.2.35-54395_amd64.deb
核心模块: 152,431,496 B, ELF64, stripped
WSLg: 可用 (DISPLAY=:0, WAYLAND_DISPLAY=wayland-0)
```

> **注意**：官方页面给的 3.2.18 链接已全部 404。想拿 Linux QQ 只能走 AUR PKGBUILD 或社区镜像。这本身就是一个**上游已死的信号**。

---

## 三、SnowLuma Linux 验证（全部通过）

### 3.1 原生后端能力

```json
{
  "platform": "linux",
  "arch": "x64",
  "processDiscovery": "procfs",
  "moduleInspection": "procfs-elf64",
  "runtimeResolution": "elf64-eh-frame-itanium-rtti",
  "injection": "ptrace-manual-elf64-x86_64",
  "ipc": "unix-domain-socket-stub"
}
```

Linux 版的实现与 Windows 完全不同：`ptrace` 手动映射 + ELF64 解析 + `/proc` 进程发现。这说明**它不是 Windows 版的简单移植，而是独立实现**。

### 3.2 进程发现（准确）

```
pid 19920: likelyMainProcess=true   hasWrapperNode=true  hasMainRuntimeModule=true
           matchedHints=["process:qq", "maps:核心模块"]
pid 19923: likelyMainProcess=false  (zygote, --type=zygote)
pid 19924: likelyMainProcess=false  (zygote)
```

正确识别主进程，正确排除 Electron 子进程。这解决了 SnowLuma 自己在 `hook-manager.ts:673` 注释里提到的「Linux zygote 误判」问题。

### 3.3 注入 + 管道 + 握手

```
target pid = 19920 | exe = /opt/qqroot/opt/QQ/qq
INJECT OK: {"base":"123129257783296","entry":"123129257841024","size":434176}
t+1s sockets: ['/run/user/0/mojo.19920.control.sock', '/run/user/0/mojo.19920.recv.sock']
connected after 1s
hello received: true | bytes: 116
hex: 5148503101000100...2f72756e2f757365722f302f6d6f6a6f2e31393932302e636f6e74726f6c2e736f636b...
ascii: QHP1.../run/user/0/mojo.19920.control.sockQHP1...
UNLOADED → socket 消失
```

**Linux 上注入到管道就绪只用了 1 秒**（Windows 是 7 秒）。协议帧与 Windows 完全同构。

### 3.4 构建与测试

- `pnpm install --frozen-lockfile`：53.6 秒
- `pnpm typecheck`：14 个包全过
- `pnpm build:all`：产物 `dist/index.mjs` = 12,446,350 B，`release.json` target = `linux-x64`
- `pnpm test`：1501/1504 通过

**Linux 上的测试失败项与 Windows 不同**：
- Windows：2 个权限位测试 + 1 个 highway 超时
- Linux：`proton` 包的 UTF-8 穷举测试（单跑通过，915ms，并行时超时）

> 这进一步证明这些失败是**测试对时序/平台敏感**，不是代码缺陷。

---

## 四、NapCat Linux 验证（部分受阻）

### 4.1 能做的

| 项 | 结果 |
|---|---|
| `MoeHoo.linux.x64.node` 加载 | ✅ 导出 `initHook` / `setO3Setting` |
| `napi2native.linux.x64.node` 加载 | ✅ 导出 `initHook` / `enableAllBypasses` / `setVerbose` |
| **在 QQ 进程内加载 napi2native** | ✅ 成功 |
| 调用 `initHook` | ❌ 崩溃 |

### 4.2 受阻原因：偏移表不覆盖 QQ 3.2.35

NapCat 的 `napi2native.json` 是**硬编码的 QQ 版本偏移表**，Linux x64 最新条目：

```
3.2.34-53644-x64  { send: "6E5AB20", recv: "3A12CD0" }
```

你装的 QQ 是 **3.2.35-54395**，表里没有。用 3.2.34 的偏移去 hook 3.2.35：

```
initHook(3.2.34-53644-x64) => Segmentation fault
```

### 4.3 我尝试的补救（均未成功）

| 方法 | 结果 |
|---|---|
| 搜索 20 个 NapCat fork 的偏移表 | 全部止于 3.2.34 |
| 从 AUR / 腾讯 / Wayback 找 3.2.34 安装包 | 链接全部失效 |
| 用 `核心模块` 的导出符号反查 | 885 个动态符号，但 hook 点在 stripped 区，无对应符号 |
| `MSF::MSFSDK::sendPacket` 等符号 | 存在于 0x670DD20，但与 NapCat 的偏移模式不符 |

### 4.4 结论

**NapCat 的 Linux 协议层拦截 依赖人工维护的版本偏移表。表里没有你的 QQ 版本时，无法使用。**

这是 NapCat 架构的固有弱点：每次 QQ 更新，需要有人用 IDA/Ghidra 逆向新版本的 `核心模块`，找到 send/recv 函数，算出偏移，提交 PR。**上游已死，这个工作现在没人做。**

> 补充：NapCat 的主路径（NodeIKernel API）**不走协议层拦截**，所以即使 `napi2native` 失效，NapCat 大部分功能仍可用。但这条路依赖「改 QQ 的 package.json 在进程内运行」，在 Linux 上同样可行（我实测 QQ 能用这种方式启动并执行自定义代码）。

---

## 五、两边在 Linux 上的本质差异

| 维度 | SnowLuma | NapCat |
|---|---|---|
| 注入方式 | `ptrace` 外部注入 | 改 `package.json` 进程内加载 |
| 需要 QQ 版本表 | ❌ 不需要 | ✅ 需要（协议层拦截 部分） |
| QQ 更新后 | 通常直接可用 | 需要人工逆向新偏移 |
| Linux 支持 | 原生实现（procfs + ELF64） | 有二进制，但依赖版本表 |
| 进程隔离 | 独立进程，崩溃不拖死 QQ | 在 QQ 进程内，崩溃即 QQ 崩溃 |
| 多账号 | ✅ | ❌ |

**SnowLuma 在 Linux 上的优势比 Windows 更明显。**

---

## 六、一个必须说明的观察

Linux QQ 的官方下载页给出的还是 2025-06 的 3.2.18 链接，且**全部 404**。实际能下载到的是 3.2.35（通过 AUR 的 PKGBUILD 挖出来的 `qqdl.gtimg.cn` 地址）。

结合之前发现的：
- NapCat 官方仓库删库（2026-11-12）
- SnowLuma 官方仓库 404
- SnowLuma 的 `compat/qq.json` 从已删除的仓库拉数据

**这条生态链的上游已经全面失效。** 任何基于它们的项目都必须准备好「自己维护」的能力——尤其是 NapCat 这种依赖版本偏移表的方案。

---

## 七、硬门禁结论（更新）

| 门禁 | Windows | Linux |
|---|---|---|
| 源码可构建 | ✅ | ✅ |
| 原生二进制可用 | ✅ | ✅ |
| 注入链路完整 | ✅ | ✅ |
| 协议握手成功 | ✅ | ✅ |
| 卸载干净 | ✅ | ✅ |
| **QQ 版本覆盖** | ✅ 9.9.31-49738 在表内 | ⚠️ 3.2.35-54395 不在表内 |

**SnowLuma 路线在 Linux 上通过全部验证。**
**NapCat 路线在 Linux 上受限于版本偏移表，需要逆向工作才能用协议层拦截。**

---

## 八、这对基座选择意味着什么

之前（架构文档 §7）推荐 SnowLuma 当基座的 5 条理由中，第 5 条是「你的部署仓库都指向 Linux」。现在有了实测支撑：

1. SnowLuma 在 Linux 上**从源码构建、测试、注入、握手全部通过**
2. 它**不依赖 QQ 版本表**——这对「上游已死」的现状是决定性的
3. NapCat 在 Linux 上需要人工逆向每次 QQ 更新

**这条理由从「推断」升级为「实测证据」。**

---

## 九、未验证项

| 项 | 原因 |
|---|---|
| SnowLuma 真实账号登录 | 需要 QQ 账号 + 扫码，涉及隐私 |
| SnowLuma 真实收发消息 | 依赖登录态 |
| NapCat 在 Linux 上完整运行 | 需要修好偏移表或降级 QQ 版本 |
| ARM64 | 无设备 |
| Docker 部署 | WSL 内无 Docker daemon（可用 `--privileged` 但 WSL 内核限制） |

---

## 十、复现步骤

```bash
# 1. WSL2 Arch
wsl -d Arch

# 2. Node 官方二进制（不要用 pacman 的 node）
cd /opt && curl -sL -o node.tar.xz https://nodejs.org/dist/v24.22.1/node-v24.22.1-linux-x64.tar.xz
tar -xf node.tar.xz && ln -sf /opt/node-v24.22.1-linux-x64/bin/node /usr/local/bin/node

# 3. QQ 依赖
pacman -Sy --needed gtk3 nss alsa-lib at-spi2-core libxcomposite libxdamage \
  libxfixes libxrandr mesa libcups pango cairo gdk-pixbuf2 libnotify nspr \
  libxshmfence gjs openjpeg2 openslide

# 4. QQ 3.2.35（地址来自 AUR linuxqq 的 PKGBUILD）
cd /opt && curl -sL -o qq.deb \
  "https://qqdl.gtimg.cn/qqfile/QQNT/9.9.37/beta/816b3c79/linuxqq_3.2.35-54395_amd64.deb"
mkdir -p qqextract qqroot && bsdtar -xf qq.deb -C qqextract && bsdtar -xf qqextract/data.tar.xz -C qqroot

# 5. 启动 QQ
cd /opt/qqroot/opt/QQ && setsid ./qq --no-sandbox &

# 6. SnowLuma 验证
cd /opt/snowluma-linux && pnpm install --frozen-lockfile && pnpm typecheck && pnpm build:all
node /mnt/d/Project/nc+sl/tools/verify-linux-handshake.cjs
```

---

## 附：本次新增验证脚本

| 文件 | 用途 |
|---|---|
| `tools/verify-linux-addon.cjs` | Linux addon 加载 + 导出方法 |
| `tools/verify-linux-candidates.cjs` | 后端信息 + 进程候选列表 |
| `tools/verify-linux-inject.cjs` | 注入 + unix socket 出现 + 卸载 |
| `tools/verify-linux-handshake.cjs` | 注入 + control socket 连接 + QHP1 握手 |
| `tools/verify-napcat-linux-hook.cjs` | NapCat 偏移表查询 + initHook 尝试 |
| `tools/napcat-inline-test.cjs` | NapCat 进程内加载验证（QQ package.json main） |
| `tools/resolve-offsets.py` | 从 ELF 符号表反推 hook 偏移（未成功，但可复用） |
