# Rust Flash Fxp 架构文档

## 目的

这里存放 `Rust Flash Fxp` 的架构文档，采用"总览 + 专题设计 + 参考资料"的组织方式，便于持续演进。

## 文档导航

- [架构总览](./overview.md)
- [快速连接](quick-connect.md)
- [文件查看与编辑](file-editing.md)
- [FTP 会话日志](ftp-session-log.md)

## 当前已确认约束

- 核心库 `src/`（crate `flashfxp_lib`）与 UI 框架解耦：更换 UI 层不得要求改动核心库。
- 远端会话统一走 `RemoteSession` 枚举：FTP/FTPS 走 `FtpSession`，SFTP 走 `SftpBackend`（密码认证，不走代理）。
- GBK 编码文件名必须走自建 PASV 原始字节数据通道；`list()` 返回 UTF-8 lossy，不可用于 GBK。
- 站点互传是内存流水线（8×256KB 有界通道背压），不入持久化队列，非 FXP 协议。
- UI 仅中文；无远端 git 仓库，分支 master。

- [目录书签与模式高亮](browsing.md) — 原版入口、书签作用域、匹配与多窗口配置同步。
