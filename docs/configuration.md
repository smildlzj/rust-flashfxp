# 配置说明

## 目的

说明应用运行时数据的位置、各存储的职责与敏感性，以及应用内可配置项的存放方式。

## 数据存储

### `~/.rust-flashfxp/flashfxp.db`

rusqlite 数据库，表：`sites` / `groups` / `proxies` / `queue_items` / `app_config`。站点与代理密码以 AES-256-GCM 固定密钥加密落库（`src/store/crypto.rs`）。

> ⚠️ 这是用户真实站点数据（含密码）。测试站点/代理自建自清，不得误删用户站点（见 CLAUDE.md 协作约束）。

队列任务持久化于 `queue_items`；应用重启后队列**手动恢复**（▶ 恢复待传），属刻意设计，防止遗留任务自动重放到其他站点。

### `~/Library/Application Support/com.github.smildlzj.rustflashfxp/window_state.json`

窗口位置与尺寸（物理像素单位）。窗口 Moved/Resized 事件防抖 500ms 后落盘，启动时恢复；dev 重启为强杀进程，不依赖退出钩子。

## 关联文档

- [架构总览](./architecture/overview.md) — 窗口状态持久化流程
- [开发指南](./development.md)
