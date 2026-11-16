# 开发指南

## 环境要求

- Rust 工具链（cargo），仓库根 `Cargo.toml` 为核心库 `flashfxp_lib`。
- Node.js + npm：`ui/` 前端（Vite 6 + React 18）。
- Tauri CLI 经 `npx --prefix ui tauri` 使用（`@tauri-apps/cli` ^2，随 ui devDependencies 安装）。

## 安装依赖

```bash
npm --prefix ui install   # 前端依赖；Rust 依赖首次 cargo 构建自动拉取
```

## 构建

```bash
npm --prefix ui run build     # 仅前端（vite build）
npx --prefix ui tauri build   # 正式打包桌面应用
```

## 本地开发

```bash
# 开发运行（前端 HMR + Rust watch 自动重编译）
env -u NODE_OPTIONS npx --prefix ui tauri dev
```

- **必须 `env -u NODE_OPTIONS`**：WorkBuddy 的 node-safe-delete shim 会拦截 Vite 清理 `.vite/deps_temp_*`，导致 dev 启动失败。
- **改 `src/` 核心库后必须 `touch src-tauri/src/lib.rs`** 触发重编译（tauri dev 只 watch src-tauri）。
- **pkill 二进制会连带退出整个 tauri dev**（cargo run 退出）；改 src-tauri 自动重启。

## 测试

测试命令、本地集成测试服务器与 UI 自动化驱动见 [testing.md](./testing.md)。

```bash
cargo check --no-default-features   # Rust 检查；与 dev 构建保持同 flag
cargo test --lib                    # Rust 单元测试
npm --prefix ui run test            # 前端测试（ui/tests/）
```

## 常见问题

- **React StrictMode**：`useState` 初始化器引用组件内后定义的 const = TDZ 崩溃白屏（本项目踩过 3 次）；事件回调注册于首次渲染 → 读状态必须走 ref；`setupListener` 必须幂等（Promise 缓存），否则事件被处理两遍。
- suppaftp 6 async 是 async-std 系：TLS/明文跨变体逻辑用 `arm2!` 宏双实例化；`list()` 返回 UTF-8 lossy，GBK 文件名必须走自建 PASV 原始字节通道。
- rustls 多 provider 共存 panic → 启动时 `ring::default_provider().install_default()`（幂等，在 tls.rs make_connector）。
- Tauri 2：事件 listen 需 `capabilities/default.json` 含 `core:default`；系统拖入文件走 `tauri://drag-drop` 事件。
- 前后端字段名兼容：Rust `Entry.is_dir` ↔ 前端 `isDir`，在 `api.js` 的 `normalizeEntries()` 做双字段兼容。
- 本地文件操作 command 必须 `await spawn_blocking(...)` 后再返回，否则前端立即刷新看不到结果（曾有时序竞态）。
- 更多踩坑细节与每轮迭代记录见 `docs/plans/HANDOFF.md`（本地文档，不入库）。

## 关联文档

- [架构总览](./architecture/overview.md)
- [测试规范](./testing.md)
- [配置说明](./configuration.md)
