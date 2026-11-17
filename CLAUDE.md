# CLAUDE.md

> AI 协作入口。仅放本项目特有的高频必备信息，深层细节通过下方"深入文档"按需获取（渐进式披露）。
> 不重复 README 等普通文档的可见内容，不写语言/框架通用知识。

## 项目概要

- 复刻 Windows 经典 FTP 客户端 FlashFXP 的跨平台桌面应用（macOS），产品名 **Rust Flash Ftp**。支持 FTP/FTPS/SFTP、双栏浏览、断点续传、队列持久化、同步浏览、目录比较、SOCKS5/HTTP 代理、站点互传（内存流水线，非 FXP 协议）。UI 支持简体中文 / English（选项 → 语言）。
- **`docs/plans/HANDOFF.md` 是权威交接文档**（本地，不入 git）：含功能完成状态、已知待办、每轮迭代记录与踩坑细节。做任何改动前先读它，改完后如影响功能状态需同步更新。

## 布局约束

- `src/` 核心库 `flashfxp_lib`（与 UI 框架无关）；`src-tauri/` Tauri 2 后端（单文件 lib.rs）；`ui/` React 18 前端。曾从 egui 整体迁到 Tauri，核心库零改动。
- 死代码保留勿删：egui 旧版（`src/main.rs` + `src/app/`）、`ui/src/icons.jsx`；删除需全量重编译/重装依赖。
- 运行时数据：`~/.rust-flashfxp/flashfxp.db` 与 `~/Library/Application Support/com.github.smildlzj.rustflashfxp/window_state.json`（详见 `docs/configuration.md`）。

## 构建与测试

```bash
env -u NODE_OPTIONS npx --prefix ui tauri dev   # 开发运行；必须摘掉 NODE_OPTIONS（WorkBuddy shim 破坏 Vite 启动）
cargo check --no-default-features               # Rust 检查；与 dev 构建保持同 flag
cargo test --lib                                # Rust 单测；集成测试与本地测试服务器见 docs/testing.md
npm --prefix ui run build                       # 前端构建
```

## 协作约束

- 远端 `172.21.86.30`（SFTP，站点 ID 1）**只允许操作 `/tmp/rustftp/*`**，测试自建自清，不留残留。
- `~/.rust-flashfxp/flashfxp.db` 是用户真实数据，测试站点/代理自建自清，不得误删用户站点。
- 队列恢复为**手动**（▶ 恢复待传），是刻意设计，防止遗留任务自动重放到其他站点，勿改回自动。
- 无远端 git 仓库；分支为 master。

## 深入文档（按需阅读）

| 需要什么 | 读哪里 |
|---|---|
| 架构导航、专题设计 | `docs/architecture/README.md` |
| 架构总览（分层/模块/关键流程） | `docs/architecture/overview.md` |
| 开发流程、命令全表、常见坑 | `docs/development.md` |
| 测试规范、本地测试服务器、UI 自动化驱动 | `docs/testing.md` |
| 数据存储与配置文件 | `docs/configuration.md` |
| 怎么编写 / 维护本项目文档 | `docs/writing-guide.md` |
| 交接状态、待办、迭代记录 | `docs/plans/HANDOFF.md`（本地，不入库） |

## 其他

- 本文件为 AI 协作权威源；`AGENTS.md` 等其他 agent 配置文件的内容派生自本文件。
