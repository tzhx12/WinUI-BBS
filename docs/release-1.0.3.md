# WinUI-BBS 1.0.3

1.0.3 修复一键安装的 systemd 服务因临时目录只读而导致头像、图床、表情和帖子/回复附件上传失败的问题。

## 上传临时目录修复

- 新安装的应用服务增加 `PrivateTmp=true`，提供可写的独立临时目录，同时保留 `ProtectSystem=strict`。
- Linux 安装验收新增 13 条真实图片上传与读取检查，覆盖头像、普通/个人/后台图床、个人/后台表情、站点图标、首页/热门背景、板块图标/背景及帖子/回复附件。
- 配置指南补充旧安装出现 `EROFS: read-only file system, mkdtemp '/tmp/forum-media-*'` 或 `forum-submission-*` 时的处理步骤。

## 已有一键安装实例需要配置一次服务

升级程序不会重写已有 systemd 服务文件。由 1.0.2 或更早安装脚本创建的实例，需要执行以下命令；已经配置 `PrivateTmp=true` 的实例沿用现有配置：

```sh
sudo install -d -m 755 /etc/systemd/system/winui-bbs.service.d
printf '[Service]\nPrivateTmp=true\n' | sudo tee /etc/systemd/system/winui-bbs.service.d/30-private-tmp.conf >/dev/null
sudo systemctl daemon-reload
sudo systemctl restart winui-bbs
```

此覆盖文件会在后续程序更新时保留。新安装由 1.0.3 安装脚本自动配置。

## 升级程序

已有一键安装实例可在“站点设置 → 系统更新”选择 Releases 并升级；手动部署使用附件 `winui-bbs.tar.gz`。源码部署更新后执行 `npm ci`、`npm run check`、`npm run build`，再重启服务。保留完整前端 `dist` 及 `.br` / `.gz` 文件。

此次更新没有新增数据库迁移。升级前备份 PostgreSQL、完整 `apps/api/data/`、对象存储和原部署配置，并保留原 `MAIL_ENCRYPTION_KEY` / `STORAGE_ENCRYPTION_KEY`。

安装与恢复步骤见[发布与恢复指南](https://github.com/tzhx12/WinUI-BBS/blob/v1.0.3/docs/releases.md)，完整功能见[使用与配置](https://github.com/tzhx12/WinUI-BBS/blob/v1.0.3/docs/configuration.md)。
