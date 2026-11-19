# 架构总览

## 目标与范围

本架构当前优先解决的问题：

1. FTP/FTPS/SFTP 三协议在同一接口下可互换（`RemoteSession` 枚举分派）。
2. 核心库与 UI 框架解耦：曾从 egui 整体迁到 Tauri，核心库零改动。
3. 前后端以单向消息边界隔离：前端不直接持有会话，一切经 UiCmd/UiEvent。
4. 断点续传与队列持久化（rusqlite），重启后手动恢复。
5. 站点互传不落盘：源/目标两条连接间内存流水线直转。
6. 中文（GBK）与 UTF-8 文件名兼容。

## 核心结论

三层结构，职责划分：

- `src/` 核心库 `flashfxp_lib`：协议、会话、传输、存储，不依赖任何 UI 框架。
- `src-tauri/` 宿主层：Tauri 2 后端（单文件 `lib.rs`），command 桥接 + 事件 emit。
- `ui/` 前端：React 18（Vite + Tailwind v4 + shadcn/ui base-nova + lucide），Win32 风格控件库自建（`win32.jsx`/`winicons.jsx`）。

设计原则（每条一句话）：

- 核心库是唯一执行域，UI 层只是宿主与视图。
- `UiCmd` 是前端到后端的唯一入口（unbounded channel），`UiEvent` 是回传唯一通道（Tauri 事件 `fx-event`）。
- 浏览与传输分离：`run_session` 处理列目录/建删改，`run_transfers` 用独立连接顺序执行队列。
- 会话因错误失效即弃用，下个任务重连，不尝试复用坏连接。
- 密码 AES-256-GCM 固定密钥加密后落库（`src/store/crypto.rs`）。
- 死代码（egui 旧版 `src/main.rs` + `src/app/`、`ui/src/icons.jsx`）保留为历史对照，删除需全量重编译/重装依赖。

## 系统图

```text
┌─────────────────────────────────────────────────────┐
│ ui/  React 18 前端                                   │
│   api.js：invoke 封装 + fx-event 监听（幂等）         │
│   App.jsx / win32.jsx / winicons.jsx / components/   │
└───────────────┬─────────────────────────────────────┘
                │ invoke(command)          ┌──────────┐
                │ ◀── emit "fx-event"      │ 窗口状态  │
┌───────────────▼──────────────────────┐   │ 防抖落盘  │
│ src-tauri/  Tauri 2 宿主（lib.rs）    │──▶└──────────┘
│   29 个 command → send_cmd(UiCmd)     │
│   UiEvent → emit("fx-event")          │
└───────────────┬──────────────────────┘
                │ unbounded channel
┌───────────────▼─────────────────────────────────────┐
│ src/  核心库 flashfxp_lib                            │
│   bus.rs      UiCmd/UiEvent + Entry/TransferTask/…   │
│   session/    ftp.rs（run_backend 总调度）            │
│               sftp.rs / relay.rs / list_parse.rs     │
│               proxy.rs / tls.rs                      │
│   store/      rusqlite（sites/proxies/queue/…）       │
│               crypto.rs（AES-256-GCM）               │
└─────────────────────────────────────────────────────┘
```

## 关键流程

### 命令往返

前端 `invoke(command)` → `src-tauri` `send_cmd` 转 `UiCmd` 入 channel → `run_backend`（src/session/ftp.rs）消费 → 产生 `UiEvent` 经 `fx-event` emit 回前端监听器。

### 建立连接

`UiCmd::Connect` → tokio::spawn `run_session` + `run_transfers` 两 worker → `RemoteSession::open` 按 `site` 协议分派后端 → 初始目录取 `site.remote_path`，不可用回退服务器默认目录（pwd）→ `UiEvent::RemoteList`。

### 队列传输

`UiCmd::Enqueue` → `run_transfers` 逐任务：先查取消标记 → 懒建独立连接 → `exec_task`（单文件或目录递归 walk：先建全部目录再传文件）→ `TransferStarted/Progress/Finished`；任务失败丢弃连接，下个任务重连。

### 站点互传

`UiCmd::RelayEnqueue` → `run_relay`（src/session/relay.rs）→ 源/目标各开独立 `RemoteSession` → `relay_file` 以 `tokio::join!` 并发 `read_chunks`（源读）与 `write_chunks`（目标写），中间 8×256KB 有界通道做背压——目标写不动时源端自动暂停。

### 窗口状态持久化

窗口 Moved/Resized 事件 → 内存队列 + 防抖 500ms → 写 `window_state.json`（逻辑像素单位）；启动时先由 `restore_win_state` 恢复普通尺寸和位置，再最大化显示主窗口。最大化和全屏期间跳过持久化。

## 继续阅读

- [架构域导航](./README.md)
- [开发指南](../development.md) — 命令全表与开发常见坑
- [测试规范](../testing.md) — 测试与 UI 自动化驱动
- [配置说明](../configuration.md) — 数据目录与存储格式
