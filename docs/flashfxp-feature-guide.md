# FlashFXP 原版功能调研与实现指南

开发或调整以 Windows FlashFXP 为参照的功能时，先查官方资料，确认用户可见的行为，再实现和验收。

## 实现前调研

1. 从[官方功能列表](https://www.flashfxp.com/features)定位功能，再查[在线帮助](https://www.flashfxp.com/webhelp/Topics/preferences.htm)中相关的菜单、对话框和首选项。涉及版本差异时，查[官方版本记录](https://www.flashfxp.com/history.php)，注明参照版本或文档日期。
2. 记录官方页面链接和本次范围。按功能需要核对入口、菜单名称、快捷键、可用条件、操作对象、默认值、确认和取消，以及操作完成后的可见结果。涉及文件列表时，分别核对本地与远程、文件与目录、单选与多选。
3. 官方资料未说明的行为标为待验证。有条件时在 Windows FlashFXP 实测，记录版本、操作步骤和观察结果。仍无法确认的细节，记录本项目采用的行为及原因。

## 实现与验收

按确认的交互流程和行为语义实现，界面沿用 Rust Flash Ftp 的组件和中英文文案。平台快捷键、任务范围或失败处理有差异时，记录本项目的取舍。按实际可用入口验证菜单和快捷键，并覆盖与该功能相关的成功、取消和失败路径。在文档或交付说明里列出尚未实测的行为。

例如，调研「查看文件／编辑文件」时，先确认选择条件和查看器、编辑器的关联规则，再分别核对本地打开、远程临时下载、保存后上传策略，以及取消或上传失败的结果。参见[查看与编辑设置](https://www.flashfxp.com/webhelp/Topics/view-edit.htm)和[文件关联](https://www.flashfxp.com/webhelp/Topics/file-associations-dialog.htm)。

## 关联文档

- [开发指南](development.md)
- [测试规范](testing.md)
- [目录书签与模式高亮的调研记录](architecture/browsing.md)
