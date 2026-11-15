# 资源占用

> 实测环境：NAS（Debian 12）· Docker · QQ Linux 3.2.28-48517 · 已登录 1 个账号
> 测量方式：容器内 `cgroup` 统计 + 进程 RSS 明细

---

## 一、总览

| 指标 | 数值 |
|---|---|
| **容器实际内存（cgroup）** | **约 666 MB** |
| ├ 匿名内存（进程本身） | 489 MB |
| ├ 文件缓存 | 140 MB |
| └ 内核 slab | 9 MB |
| CPU（空闲） | 2–4 % |
| 镜像大小 | 约 1.2 GB |
| 数据目录 | 随消息量增长（SQLite + 媒体缓存） |

> **为什么不用 RSS 求和**：多个进程共享同一份动态库（Qt / Electron / ICU），
> RSS 会重复计算。把所有进程的 RSS 加起来约 959 MB，比真实占用高 40%。
> **cgroup 的 `memory.current` 才是容器真正占用的内存。**

---

## 二、进程明细

| 进程 | RSS | 说明 |
|---|---|---|
| QQ 主进程 | 237 MB | Electron 主进程 |
| QQ 子进程 ×8 | 424 MB | 渲染 / GPU / zygote / utility |
| Nekolux 运行时 | 297 MB | Node 24 + WebUI 服务 |
| Xvfb + openbox | 22 MB | 虚拟显示（无桌面环境时） |

> RSS 列存在共享页重复计算，仅供参考。看总量请用上表的 cgroup 数字。

---

## 三、容量规划

| 场景 | 建议内存 |
|---|---|
| 单账号，轻量使用 | **2 GB**（够用但余量不多） |
| 单账号，推荐 | **4 GB** |
| 多账号 | 4 GB + **每账号约 150 MB** |
| 大量媒体收发 | 额外预留 500 MB–1 GB（媒体缓存） |

### 为什么 QQ 占这么多

QQ NT 是 Electron 应用，本身就有主进程 + 渲染进程 + GPU 进程 + 多个 zygote，
光框架开销就 400–500 MB。这部分**与 Nekolux 无关**——即使不用 Nekolux，
在无头 Linux 上跑 QQ 也是这个量级。

Nekolux 运行时（297 MB）主要是 Node 24 + 消息存储 + WebUI 静态服务。

---

## 四、CPU

| 状态 | CPU |
|---|---|
| 空闲（轮询间隔 3s） | 2–4 % |
| 消息活跃期 | 5–15 % |
| 大量媒体处理 | 峰值 40–60 % |

降低空闲 CPU：WebUI「系统设置 → 外观 → 轮询间隔」从 3s 调到 5–10s。

---

## 五、磁盘

| 项 | 大小 |
|---|---|
| Docker 镜像 | ~1.2 GB |
| 运行时目录（`nekolux-dist`） | ~120 MB |
| 数据目录（新装） | ~50 MB |
| 消息数据库 | 约 1–3 KB / 条消息 |
| 媒体缓存 | 按实际收发量 |

清理媒体缓存：WebUI「系统设置 → 存储」里可清理，或直接删 `data/media/`。

---

## 六、实测命令

想在自己的机器上复现：

```bash
# 容器整体（最准确）
docker stats --no-stream nekolux

# 容器内 cgroup 明细
docker exec nekolux cat /sys/fs/cgroup/memory.current
docker exec nekolux cat /sys/fs/cgroup/memory.stat

# 进程明细
docker exec nekolux ps aux --sort=-rss | head -15
```

或直接用仓库里的脚本：

```bash
bash tools/nas/mem-report.sh
```
