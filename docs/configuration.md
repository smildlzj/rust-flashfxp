# 配置说明

## 目的

说明应用运行时数据的位置、各存储的职责与敏感性，以及应用内可配置项的存放方式。

## 数据存储

### `~/.rust-flashfxp/flashfxp.db`

rusqlite 数据库，表：`sites` / `groups` / `proxies` / `queue_items` / `app_config` / `bookmarks` / `highlight_rules`。站点与代理密码以 AES-256-GCM 固定密钥加密落库（`src/store/crypto.rs`）。

> ⚠️ 这是用户真实站点数据（含密码）。测试站点/代理自建自清，不得误删用户站点（见 CLAUDE.md 协作约束）。

队列任务持久化于 `queue_items`。桌面版每行保存窗口会话 `owner` 和不含密码的 `site_key`（站点 ID、协议、主机、端口、用户名、ACCT）；恢复仅认领已退出实例且目标身份匹配的任务，仍须点击“恢复待传”。待恢复为 `pending`，已提交为 `queued`；两者均可在进程退出后恢复，已提交任务不能重复提交，状态更新和清理限当前实例。

应用数据目录下的 `instances/<实例标识>.lock` 由每个窗口会话持有排他锁；崩溃或退出自动释放。恢复时先检查锁，再用数据库原子更新认领，避免两个实例重复恢复同一任务。窗口会话标识不使用 PID 单独判断。站点与代理仍共享同一个数据库。数据库连接的写锁忙等待为 5 秒。旧版无实例和站点身份的队列不自动归属当前站点。

### `~/Library/Application Support/com.github.smildlzj.rustflashfxp/window_state.json`

窗口位置与尺寸（逻辑像素单位）。窗口 Moved/Resized 事件防抖 500ms 后原子替换写入，启动时恢复；dev 重启为强杀进程，不依赖退出钩子。

## 关联文档

- [架构总览](./architecture/overview.md) — 窗口状态持久化流程
- [开发指南](./development.md)

## 界面偏好

WebView localStorage 的 `fx.ui.language` 保存 `zh-CN` 或 `en`，默认简体中文。在“选项 → 语言”切换时不重载页面，现有连接、传输和历史日志保留；新生成的应用消息使用当前语言。同一应用中的所有窗口会同步语言选择；现有连接、队列及历史日志不受影响。

底部尺寸保存在 `fx.ui.bottomHeight`、`fx.ui.queueWidth`，其他布局和默认目录继续使用 `fx.ui.*` 偏好。

## 多窗口运行

会话 → 新建会话（F12）与原生 Cmd+N 在当前进程创建 `session-*` WebviewWindow。`main` 与每个新窗口分别拥有后台命令通道、当前站点、队列租约和运行时任务映射；站点/代理配置及语言为应用共享。事件定向发送给所属 WebviewWindow，worker 任务使用全局唯一 ID，界面使用窗口内 ID。

关闭窗口会隐藏并保留其连接和任务；Dock / 托盘恢复最近使用窗口。连接成功时原生窗口标题显示“站点名 — Rust Flash Ftp”，快速连接显示“主机:端口 — Rust Flash Ftp”，断开时恢复默认标题；Dock 和原生 Window 菜单使用该标题。退出结束整个应用及所有会话。多个会话窗口只使用一个 Dock 图标。

## 目录书签与模式高亮

书签和高亮持久化、作用域、匹配规则及多窗口保存冲突处理见 [目录书签与模式高亮](architecture/browsing.md)。
