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

## GitHub Actions 自动打包

工作流：`.github/workflows/build-desktop.yml`。

| 平台 | 架构 | 安装包 |
| --- | --- | --- |
| macOS | Apple Silicon（M 系列，aarch64） | `.dmg` |
| macOS | Intel（x86_64） | `.dmg` |
| Windows | x64（MSVC） | NSIS 安装程序 `.exe` |

下载文件统一命名为 `Rust-Flash-Ftp-v<版本>-<平台>-<架构>.<格式>`，例如：

- `Rust-Flash-Ftp-v0.1.0-darwin-arm64.dmg`
- `Rust-Flash-Ftp-v0.1.0-darwin-x64.dmg`
- `Rust-Flash-Ftp-v0.1.0-windows-x64.exe`

Actions 的 Artifact 使用相同名称但不带安装包扩展名，下载后为 ZIP，解压得到对应安装包。

### 手动打包

将代码推送到 GitHub 默认分支后，进入 **Actions → Build desktop installers → Run workflow**，选择分支运行。
完成后在该次运行的 **Artifacts** 下载对应平台安装包，保留 14 天。普通分支推送不会触发打包。
在分支上手动运行只生成 Artifacts；选择已有 `v*` 标签运行也会执行发布步骤。

### 发布版本

1. 更新 `src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、根 `Cargo.toml` 和 `ui/package.json` 的版本，并更新对应 lock 文件，提交并推送。
2. 创建与 `tauri.conf.json` 版本完全一致的 `v` 前缀标签，例如当前版本为 `0.1.0`：

   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```

3. 三个平台构建全部成功后，工作流创建 GitHub Release，上传两个 DMG、一个 EXE 和 `SHA256SUMS.txt`。
   上传先在草稿中完成，再自动发布；`v0.2.0-beta.1` 等包含连字符的版本标为预发布。
   失败后可重新运行失败的任务；发布步骤支持覆盖同名附件。

校验安装包：将下载的三个安装包与 `SHA256SUMS.txt` 放在同一目录，在 macOS 使用 `shasum -a 256 -c SHA256SUMS.txt`，Linux 使用 `sha256sum -c SHA256SUMS.txt`。

工作流使用仓库自带的 `GITHUB_TOKEN`，发布任务单独申请 `contents: write`，无需额外配置发布 Token。
如果仓库或组织策略禁止写入，需要管理员允许该工作流创建 Release。

macOS 包使用 ad-hoc 签名（`src-tauri/tauri.macos.conf.json`），无需 Apple 证书，但尚未经过 Apple 公证；首次运行可能需要在「系统设置 → 隐私与安全性」允许打开。
Windows 安装包没有商业代码签名，可能显示 SmartScreen 提示。以后若需要可信签名与公证，可再接入相应证书和 Secrets。

### DMG 安装窗口

安装窗口采用浅色背景、中文拖拽提示、左侧应用和右侧 Applications，窗口大小为 720 × 440。
背景包含普通与 Retina 分辨率，资源位于 `src-tauri/dmg/`；修改绘图源码后，在 macOS 仓库根目录运行 `swift scripts/dmg/render-background.swift` 重新生成。
运行时添加 `--preview` 可生成包含示意图标的布局预览；预览图不会作为安装背景打包。

Actions 先用 Tauri 生成 `.app`，再使用 `dmgbuild` 直接写入背景和 Finder 布局，避免依赖 CI 上的 Finder 自动化权限。
本地要生成相同样式，可先生成应用包，再运行打包脚本（Python 3.12）：

```bash
# 在 src-tauri/ 内生成 .app 后，回到仓库根目录运行下方命令
# npx --no-install --prefix ../ui tauri build --ci --bundles app -- --locked
python3 -m venv .venv-dmg
.venv-dmg/bin/python -m pip install -r scripts/dmg/requirements.txt
.venv-dmg/bin/python scripts/dmg/build.py \
  --app "src-tauri/target/release/bundle/macos/Rust Flash Ftp.app" \
  --output "src-tauri/target/release/bundle/dmg/Rust Flash Ftp.dmg"
```

如果构建时传入 `--target`，需要在 `target/` 后补上对应 target triple。

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
