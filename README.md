<div align="center">

# Nekolux 文档

**Nekolux.aprism.top** · 部署指南 / 插件开发 / 协议逆向记录

</div>

---

## 快速导航

| 我想… | 看这里 |
|---|---|
| 装起来跑通 | [NAS-DEPLOYMENT](NAS-DEPLOYMENT.md) · [RUNTIME-ASSEMBLY](RUNTIME-ASSEMBLY.md) |
| 写插件 | [PLUGIN-SYSTEM](PLUGIN-SYSTEM.md) |
| 了解 QQ 协议层怎么 hook | [LINUX-HOOK-INVESTIGATION](LINUX-HOOK-INVESTIGATION.md) · [NAPCAT-OFFSET-REVERSING](NAPCAT-OFFSET-REVERSING.md) |
| 维护偏移/签名 | [OFFSET-MAINTENANCE](OFFSET-MAINTENANCE.md) |
| 多账号 | [MULTI-ACCOUNT](MULTI-ACCOUNT.md) |
| 看验证数据 | [reports/](reports/) |

## 文档索引

### 入门

- [项目总览](PROJECT-README.md) —— 特性、定位、快速开始
- [运行时装配](RUNTIME-ASSEMBLY.md) —— bootstrap、插件接线、数据目录
- [NAS 部署](NAS-DEPLOYMENT.md) —— Docker 部署到群晖/威联通

### 插件开发

- [插件系统](PLUGIN-SYSTEM.md) —— 完整 API 参考
  - 生命周期钩子（`plugin_init` / `onmessage` / `onevent` / `onpacket`）
  - `ctx.actions` 注册自定义 action
  - `ctx.callAction` 调用内置能力
  - `ctx.packets` 原始封包监听
  - `ctx.router` 扩展页与静态资源
  - `plugin_config_ui` 动态配置表单
  - `ctx.plugins` 插件内省
  - 安全边界与沙箱

### 协议层

- [Linux 封包 Hook 调查](LINUX-HOOK-INVESTIGATION.md) —— 3.2.35 分层模型、修正记录
- [封包 Hook 集成](PACKET-HOOK-INTEGRATION.md) —— 自研注入器 + hook 模块
- [偏移维护](OFFSET-MAINTENANCE.md) —— 签名扫描、跨版本验证矩阵
- [NapCat 偏移逆向](NAPCAT-OFFSET-REVERSING.md) —— 方法论

### 其他

- [多账号](MULTI-ACCOUNT.md)
- [合并方案](MERGE-PLAN.md) —— 项目历史与阶段规划
- [E2E 验证](E2E-VERIFICATION.md)
- [NAS 测试报告](NAS-TEST-REPORT.md)

### 报告

- [x64 codec 存活实验](reports/X64-CODEC-ALIVE-EXPERIMENT.md) —— 推翻「结构性失效」的决定性证据
- [NAS 验收](reports/NAS-ACCEPTANCE-2026-11-15.md) —— 戳一戳撤回闭环
- [阶段 0 验证（Windows）](reports/PHASE0-VERIFICATION.md)
- [阶段 0 验证（Linux）](reports/PHASE0-LINUX-VERIFICATION.md)
- [架构分析](reports/ARCHITECTURE-ANALYSIS.md)

## 相关仓库

| 仓库 | 用途 |
|---|---|
| [Nekolux](https://github.com/AperturePrism/Nekolux) | 主仓库（代码） |
| [Nekolux-Plugins](https://github.com/AperturePrism/Nekolux-Plugins) | 插件远程源（市场索引 + 安装包） |
| Nekolux-Docs | 本仓库 |

## 许可

文档与主仓库一致，采用 [PolyForm Noncommercial 1.0.0](LICENSE.md)：
允许非商业使用与修改，不允许商业用途。
