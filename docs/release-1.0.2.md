# WinUI-BBS 1.0.2

1.0.2 修复 NavigationView 已展开的分组在点击子项后意外收起的问题。

## 导航展开状态修复

- 后台切换子页面时，权限刷新会保留同一菜单项的对象身份，已展开的分组保持展开。
- 板块数据和未读数量刷新同样保留分组的展开、收起状态。手动收起后不会因后台会话刷新而重新展开。
- 权限撤销时，对应菜单项和无权访问的页面仍会移除；菜单标签、排序和通知徽章继续按当前数据更新。
- 手机选择子项后，重新打开侧栏可继续看到原来展开的分组。

## 从 1.0.1 升级

已有一键安装实例可在“站点设置 → 系统更新”选择 Releases 并升级；手动部署使用附件 `winui-bbs.tar.gz`。源码部署更新后执行 `npm ci`、`npm run check`、`npm run build`，再重启服务。保留完整前端 `dist` 及 `.br` / `.gz` 文件。

此次更新没有新增数据库迁移。升级前备份 PostgreSQL、完整 `apps/api/data/`、对象存储和原部署配置，并保留原 `MAIL_ENCRYPTION_KEY` / `STORAGE_ENCRYPTION_KEY`。

安装与恢复步骤见[发布与恢复指南](https://github.com/tzhx12/WinUI-BBS/blob/v1.0.2/docs/releases.md)，完整功能见[使用与配置](https://github.com/tzhx12/WinUI-BBS/blob/v1.0.2/docs/configuration.md)。
