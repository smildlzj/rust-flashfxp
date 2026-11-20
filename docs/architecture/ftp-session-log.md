# FTP 会话日志

## 界面行为

界面底部的日志区参照 FlashFXP 的会话状态窗口，按顺序显示实际发送的 FTP/FTPS 控制通道命令和服务器回复。浏览、队列传输、站点互传和远程查看与编辑均将记录送到发起窗口。互传记录带源站或目标站标记。

## FlashFXP 官方资料

- 状态窗口支持为命令、左右服务器回复、错误和普通信息分别设置颜色。 [Colors](https://s.flashfxp.com/webhelp/Topics/interface-colors.htm)
- 服务器登录消息会保留在状态窗口中，启动时可在服务器会话状态和错误／传输状态视图之间选择。 [Options](https://ftp.flashfxp.com/webhelp/Topics/general-options.htm)
- 会话状态窗口的行数设置决定保留的最大行数。 [General](https://www.flashfxp.com/webhelp/Topics/preferences-general.htm)

## 实现与验证

`src/session/ftp_log.rs` 从 suppaftp 的控制通道记录生成 `UiEvent::FtpLog`，发出事件前遮蔽 `PASS`、`ACCT` 和 `ADAT` 的参数。新增 FTP/FTPS 操作入口时，通过 `session::with_ftp_log` 接入窗口的事件转发。

`src/session/ftp_regression_tests.rs` 的本机 FTP 回归覆盖命令和回复顺序、认证参数遮蔽、多行回复及删除回退。
