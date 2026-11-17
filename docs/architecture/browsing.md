# 目录书签与模式高亮

## 原版交互依据

- [FlashFXP 书签编辑器](https://www.flashfxp.com/webhelp/Topics/folder-bookmarks-dialog.htm)：名称、本地路径、远程路径、同步浏览默认/启用/禁用。
- [FlashFXP 站点书签](https://www.flashfxp.com/webhelp/Topics/site-manager-bookmarks-tab.htm)：主窗口下拉入口与站点管理器书签页。
- [原版模式匹配](https://documentation.help/FlashFXP/pattern_matching.htm)：不区分大小写，整名匹配，*、?、字符集合、范围、[^排除] 和反斜杠转义。全局高亮位于 Options → Filters → Highlights。

## 目录书签

本地/远程地址栏星形按钮打开书签列表，Ctrl+B 打开当前活动栏书签菜单；可添加当前目录或管理书签。站点管理器增加书签页，未保存的新站点须先应用保存。

SQLite bookmarks 保存 id、scope、caption、local_path、remote_path、sync_browsing。scope 为 local、site:<站点ID> 或不含密码的 quick 连接身份。普通菜单依据当前窗口已成功建立的连接选择作用域；失败的登录不代表已连接。站点管理器可显式编辑所选保存站点的书签。

bookmark_open 根据当前窗口连接作用域重新查找 id，拒绝其他站点的旧菜单项。检查本地路径有效后，仅导航已填写的本地/远程路径；不会连接其他站点或传输文件。返回同步模式：default 保留当前窗口设置，enabled/disabled 显式更新。删除站点同时在事务内清理对应书签。

## 模式高亮

Options → Filters 仅显示已实现的 Highlights 页。规则为文件名掩码和 #RRGGBB 颜色，可新增、编辑、删除、调整顺序。原版公开资料未明确重叠规则优先级，此实现采用界面明确说明的列表首个匹配规则。

highlights.js 以非递归动态规划匹配，不执行任意正则；掩码上限 512 个 Unicode 码点，待匹配名称上限 4096，缓存 128 个掩码。无效规则不参与匹配，编辑器阻止保存。

FilePane 对两侧文件及目录的名称着色；选中时沿用选中颜色，目录比较标记独立保留，不改变文件选择、过滤、导航或传输。

## 保存与窗口同步

highlight_rules 保存稳定 ID、mask、color、position，保存整个有序列表使用事务，自动生成新 ID。highlight_rules_save_checked 以 BEGIN IMMEDIATE 比较读取时的完整基线再保存，旧窗口不能覆盖较新的规则。

browsing-changed 以 bookmarks/highlights 区分共享配置更新。列表跨窗口刷新；高亮编辑器的干净草稿随变更刷新，脏草稿保留并提示冲突，须关闭重开后再编辑。取消不会保存，应用保存后继续编辑，确定保存并关闭。站点书签面板更新列表时保留未保存编辑内容。

## 相关实现

src/store/browsing.rs、src-tauri/src/lib.rs 的 bookmark/highlight commands、ui/src/components/BookmarkManager.jsx、FiltersDialog.jsx、ui/src/highlights.js。测试使用内存数据库与受控前端状态，不访问真实站点。
