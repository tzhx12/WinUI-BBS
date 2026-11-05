# WinUI-BBS 1.0.1

1.0.1 修复首次安装时直接打开或刷新管理员创建入口，页面误显示“社区正在准备中”的问题。

## 首启入口修复

前端现在等待 Vue Router 完成初始导航后再挂载应用，确保初始化状态请求携带安全入口中的 token。直接访问完整首启链接、刷新页面和移动端打开均可显示创建管理员表单；管理员创建成功后，入口仍立即失效。

## 从 1.0.0 升级

已有一键安装实例可在“站点设置 → 系统更新”选择 Releases 并升级；手动部署使用附件 `winui-bbs.tar.gz`。源码部署更新后执行 `npm ci`、`npm run check`、`npm run build`，再重启服务。保留完整前端 `dist` 及 `.br` / `.gz` 文件。

此次更新没有新增数据库迁移。升级前备份 PostgreSQL、完整 `apps/api/data/`、对象存储和原部署配置，并保留原 `MAIL_ENCRYPTION_KEY` / `STORAGE_ENCRYPTION_KEY`。

安装与恢复步骤见[发布与恢复指南](https://github.com/tzhx12/WinUI-BBS/blob/v1.0.1/docs/releases.md)，完整功能见[使用与配置](https://github.com/tzhx12/WinUI-BBS/blob/v1.0.1/docs/configuration.md)。
