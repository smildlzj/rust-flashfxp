# 快速连接

Windows FlashFXP 通过「会话 → 快速连接」或 F8 打开单独对话框。连接下拉提供连接历史，快速连接对话框可从历史填充或转入站点管理器。参见[原版会话菜单](https://www.flashfxp.com/webhelp/Topics/session-menu.htm)和[快速连接对话框](https://ftp.flashfxp.com/webhelp/Topics/quick-connect-dialog.htm)。

## 入口与参数

- 工具栏闪电按钮打开连接菜单，已保存站点仅显示站点名称。菜单内的快速连接、会话菜单和 F8 打开同一个对话框。原有快速连接栏仍可在「查看」菜单开启。
- 支持 FTP、SFTP、隐式 FTPS 和显式 FTPS（AUTH TLS）。输入 FTP、FTPS 或 SFTP URL 可带端口、凭据和远程初始目录。FTPS URL 默认使用隐式模式，选择显式模式时使用 AUTH TLS。
- 连接请求被后端接受后，按最近使用顺序记录最多 50 条地址、协议、端口、用户名和初始目录。历史不存储密码或原始 URL。选择历史可重新填入配置，也可移除记录或在站点管理器打开待保存草稿。
