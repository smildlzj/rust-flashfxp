# Theme and Site General Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for inline execution.

**Goal:** 统一现有 shadcn 主题并还原经典 FlashFXP 常规页。
**Architecture:** React 表单与统一 CSS token；Rust Site/SQLite 兼容迁移；凭证仅通过命令参数临时覆盖。
**Tech Stack:** React 18, shadcn/ui, Tailwind 4, Tauri 2, rusqlite.
**Spec:** docs/superpowers/specs/2026-11-16-theme-site-general-design.md

## Global Constraints
- 保留现有未提交改动，不提交混合工作区，不接触真实站点数据。
- 不更换 UI 组件库；仅中文。

## Review Focus
- 旧库字段默认值和重复迁移。
- 新建站点应用后再次应用不可重复创建。
- 密码提示取消不得连接，临时密码不得写库。
- 路径在常规页清晰可见，小窗口可滚动且页脚固定。
- MLSD/SFTP 时间不得重复偏移。

### Task 1: 持久化与时间
- [x] 内存库测试覆盖新增字段、更新、旧库迁移。
- [x] 新增 notes/timezoneOffsetMinutes/loginType 字段并兼容所有 Site 构造。
- [x] 测试并实现 LIST 时区偏移，MLSD 不变。

### Task 2: 主题与表单
- [x] 统一 Zinc + muted blue token，收敛高亮和阴影。
- [x] 紧凑重排常规字段，修复保存 id，错误提示。
- [x] 临时凭证对话框与 Tauri 参数覆盖。

### Task 3: 验证
- [x] npm --prefix ui run build；cargo test --lib；cargo check --manifest-path src-tauri/Cargo.toml --no-default-features。
- [ ] 浏览器截图检查：CDP/CUA 不可用，未完成。IPC 凭证取消测试与内存库保存回读已完成。
- [x] 更新 HANDOFF，报告明确限制。

验证记录：前端 build 通过；5 项前端测试通过；Rust 13 passed / 15 ignored；根与 Tauri cargo check 通过。保留已有未提交工作，不提交。
