# Rust FlashFXP — Handoff 文档

> 最后更新：2026-11-14。接手人从这里开始。

## 项目定位

复刻 Windows 经典 FTP 客户端 **FlashFXP** 的跨平台桌面版（Rust）。范围决策（已与需求方确认）：

- 做：FTP/FTPS/SFTP、站点管理、代理（SOCKS5/HTTP CONNECT）、双栏、断点续传、队列持久化、同步浏览、目录比较、拖拽（栏间+系统）、站点互传（内存流水线，非 FXP 直传协议）
- 不做：调度器、多语言（仅中文）、皮肤、FXP 协议直传、右键系统声音等

**UI 技术路线演变**：egui（M1/M2 完整实现，见 git 历史）→ 因像素级复刻 Win32 经典界面不可行 → **Tauri 2 + React 18 + shadcn/ui + Tailwind + lucide**（当前主线）。核心库（协议/传输/存储）在迁移中零改动复用，24 个集成测试全部保留。egui 版经验已沉淀到 weknora「个人研究」知识库。

## 目录结构

```
src/                 核心库 flashfxp_lib（与 UI 框架无关）
  bus.rs             UiCmd/UiEvent 边界（= Tauri command/event 的桥）、Entry/TransferTask/RelayTask/路径工具
  session/
    ftp.rs           FTP/FTPS 会话、run_backend 总调度、队列 worker、递归目录传输、PASV 原始字节数据通道（GBK）
    sftp.rs          russh + russh-sftp 后端（密码认证）
    relay.rs         站点互传（内存流水线 8×256KB 背压）
    list_parse.rs    MLSD/LIST(DOS/UNIX)/NLST 解析器（权限/编码，单测覆盖）
    proxy.rs         SOCKS5/HTTP CONNECT 手写握手
    tls.rs           rustls 连接器（含忽略证书 verifier）
  store/mod.rs       rusqlite：sites/groups/proxies/queue_items/app_config，AES-256-GCM 固定密钥加密密码
src/main.rs          egui 旧版 bin（保留对照，可删）
src/app/             egui 版 UI（同上）
src-tauri/           Tauri 2 后端（23+ command：连接/浏览/文件操作/传输/互传/CRUD/磁盘/目录树/取消）
ui/                  React 前端（Vite + shadcn/ui；App.jsx + components/{FilePane,DirTree,SiteManager,ProxyManager,RelayDialog}.jsx）
~/.rust-flashfxp/    数据目录（flashfxp.db）——用户机器上真实存在，含用户配置的站点（172.21.86.30 SFTP）
```

## 运行与测试

```bash
# 开发运行（前端 HMR + rust watch 自动重编译）
npx --prefix ui tauri dev

# 单元测试（解析器/存储）
cargo test

# 集成测试（需先起本地服务器，见下）
cargo test -- --ignored

# 本地测试服务器
python3 -m pyftpdlib -p 2121 -d /tmp/ftproot -u test -P test -w          # FTP
python3 -m pyftpdlib -p 2122 --tls --keyfile ... --certfile ...          # FTPS（需 pyopenssl）
python3 /tmp/sftp_server.py                                              # SFTP（paramiko stub）
python3 /tmp/mini_proxy.py                                               # SOCKS5:1080 + HTTP:8080

# 真实远端测试（⚠️ 仅限 /tmp/rustftp，见下方约束）
cargo test remote_tmp_full_test -- --ignored
```

### ⚠️ 环境约束（需求方明确指定）

- 远端 `172.21.86.30`（SFTP, kingdee）**只允许操作 `/tmp/rustftp/*`**，测试自建自清
- 队列恢复已改为手动（▶ 恢复待传），避免遗留任务自动重放到其他站点

### UI 自动化驱动（dev only）

前端每 400ms 轮询 `http://127.0.0.1:5199/cmd`（`/tmp/fx_cmd_server.py` 起），写 `/tmp/fx_cmd.txt` 可驱动：`quickfill:host:port:user:pass`、`open:site|proxy|relay|about|prompt`、`menu:<名>`、`enqueue:download:文件名[:dir]`、`tab:log|queue`、`tree:off`、`sync:on`、`reload` 等。窗口句柄截图：`swift /tmp/winid.swift` 取 ID → `screencapture -l <id>`。**注意：Base UI 右键菜单无法用合成事件打开，需真人右键验证。**

## 当前完成状态

全部 P0/P1/P2 功能已实现且经真实测试：
连接/浏览/传输（REST/APPE 续传）、递归目录、FTPS 显式（实测）/隐式、SOCKS5+HTTP 代理（实测）、SFTP（实测含中文文件名）、GBK 原始字节通道、队列持久化+手动恢复+取消、同步浏览、目录比较、栏间+系统拖拽、站点互传（双 pyftpdlib 实测）、右键菜单、UI 配置持久化。UI 截图自测约 20 项通过。

## 已知待办（按优先级）

1. **右键菜单真人验证**——Base UI 菜单需要真实鼠标事件，自动化测不了（用户尚未反馈实测结果）
2. **传输中任务取消**——目前取消只对"等待中"任务生效（开始前检查取消标记）；传输中途中断需要 chunk 循环里加检查
3. **正式打包**——`npx --prefix ui tauri build`（图标已有占位闪电 PNG，建议换正式图标）
4. SFTP 接受任意主机密钥（无 known_hosts）——安全债
5. 传输队列串行（单传输连接）；互传任务不入持久化队列
6. egui 旧版（src/main.rs + src/app/）可删除减负
7. 微软式细节：双击文件名选中文字已禁用；窗口尺寸/位置未持久化

## 关键技术备忘（血泪经验）

- suppaftp 6 async = async-std 系：跨变体（TLS/明文）逻辑用 `arm2!` 宏双实例化；`list()` 返回 UTF-8 lossy 行，GBK 要走自建 PASV 原始字节通道
- rustls 多 provider 共存 panic → `ring::default_provider().install_default()`（幂等，放 make_connector）
- Tauri 2：事件 listen 需 `capabilities/default.json` 的 `core:default`；`tauri://drag-drop` 拿系统拖入
- React 严格坑：**useState 初始化器里引用组件内后定义的 const = TDZ 崩溃白屏**（本项目踩过 3 次）；事件回调注册于首次渲染 → 读状态必须走 ref
- Tauri dev：pkill 二进制会连带退出整个 dev（`cargo run` 退出）；改 src-tauri 触发自动重启，重启后页面有全量重载
- window.__fxDrive 的 setInterval 轮询仅在 `import.meta.env.DEV` 生效

## Git

主干提交至 `右键菜单 / 队列取消 / UI 配置持久化`（含完整功能史：egui 基线 → Tauri 迁移 → shadcn 复刻 → 自测修复轮）。无远端仓库。
