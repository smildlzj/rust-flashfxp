# 测试规范

## 目的

说明 Rust 与前端测试的运行方式、本地集成测试服务器的搭建，以及 DEV 模式 UI 自动化驱动的完整命令清单与时序经验。

## Rust 测试

```bash
cargo test --lib                  # 单元测试（list_parse 解析器 / store 存储，约 10 个）
cargo test --lib -- --ignored     # 集成测试（需先起本地测试服务器，见下）
cargo test --lib <测试名>          # 单跑一个测试；被 #[ignore] 的加 -- --ignored
```

## 自动回归覆盖

- `src/session/ftp_regression_tests.rs`：自建 127.0.0.1 随机端口 FTP 服务，无需预先启动服务器，不读用户数据库。覆盖 ACCT 认证分支、相对初始目录刷新和独立连接下载、列表失败恢复登录目录。下载文件在系统临时目录内创建并清理。
- `ui/tests/file-pane-context.test.mjs`：执行真实 FilePane 右键回调，覆盖本地/远程面板的删除、重命名、传输，在已有其他选中项或未选中时断言操作显式携带右键目标。
- `ui/tests/site-connection.test.mjs`：覆盖保存凭证连接、临时凭证不写库、取消不连接、匿名登录、站点不存在。
- `#[ignore]` 的协议集成测试仍依赖下列外部服务，默认单测命令不会运行这些测试。

## 本地测试服务器（按需启动）

```bash
python3 -m pyftpdlib -p 2121 -d /tmp/ftproot -u test -P test -w   # FTP
python3 /tmp/sftp_server.py                                       # SFTP stub
python3 /tmp/mini_proxy.py                                        # SOCKS5:1080 + HTTP:8080
```

## 前端测试

```bash
npm --prefix ui run test   # node --experimental-vm-modules --test tests/*.test.mjs
```

## UI 自动化驱动（仅 DEV）

仅 `import.meta.env.DEV` 生效。起 `/tmp/fx_cmd_server.py` 后，前端每 400ms 轮询 `http://127.0.0.1:5199/cmd`；往 `/tmp/fx_cmd.txt` 写命令驱动界面，`state` 命令经 `/report` 端点回读结构化界面状态到 `/tmp/fx_report.txt`。

常用命令：

| 命令 | 用途 |
|---|---|
| `quickfill:host:port:user:pass` | 填快速连接栏 |
| `connect` | 连接 |
| `site:<id>` | 切换站点 |
| `open:site\|proxy\|relay\|options\|about\|prompt\|queue` | 打开各对话框 |
| `close` | 关闭对话框 |
| `menu:<名>` / `menuitem:<label>` | 菜单操作 |
| `tool:<title>` | 工具栏按钮 |
| `click:<按钮文字>` | 按文字点击按钮 |
| `enqueue:download\|upload:文件名[:dir]` | 入队传输 |
| `tab:log\|queue\|both` | 底部标签切换 |
| `nav:<本地路径>` / `rnav:<远端路径>` | 目录导航 |
| `sel:local\|remote:<行>` | 选中行 |
| `act:local\|remote:<动作>` | 面板动作 |
| `sync:on\|off` | 同步浏览开关 |
| `compare` | 目录比较 |
| `state` | 回读结构化界面状态到 /tmp/fx_report.txt |
| `reset` / `reload` | 重置/重载 |

时序经验：

- 命令间隔 ≥1.5s；quickfill 后等 ≥3s（连接 + 自动列目录）。
- 截图：`swift /tmp/winid.swift` 取窗口 ID → `screencapture -l <id>`（失败则全屏截图 + `sips` 裁剪）。

## 关联文档

- [开发指南](./development.md)
- [架构总览](./architecture/overview.md)
