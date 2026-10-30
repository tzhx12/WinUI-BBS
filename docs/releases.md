# 构建、发布与更新

在管理后台的“站点设置 → 系统更新”检查新版本。Releases 只接收正式版；Pre-releases 接收正式版及 RC。Alpha 包仅供 CI 验证，不进入自动更新渠道。

## 发布一个版本

平时向 `dev` 提交即可生成 CI 包。准备合并时：

| 操作                      | Actions 结果              | 示例                  |
| ------------------------- | ------------------------- | --------------------- |
| 推送 dev                  | Artifacts 中的 Alpha 构建 | `0.2.2-Alpha-5939d46` |
| dev 合并 main，版本号不变 | GitHub Pre-release        | `0.2.2-rc1`           |
| dev 更改版本号后合并 main | GitHub Release            | `0.3.0`               |

正式发布前，在 `dev` 执行 `npm run version:set -- 0.3.0`。提交版本变更后合并到 `main`；根目录、API/Web workspace 和锁文件版本一起更新。Actions 只在构建目录加 Alpha / RC 后缀，不将这些后缀写回分支。main 用作 dev 的集成发布分支，每次合并推送是一个发布批次。

所有包都经过类型检查、图标检查、版本/更新脚本测试、PostgreSQL 17 集成测试及前后端构建。main 发布前还在 Ubuntu 24.04 上运行实际安装脚本，验证 systemd 站点服务、数据库及独立更新服务。`winui-bbs.tar.gz` 包含编译好的前端/API、迁移、源码、锁文件和许可证；安装时只需安装 API 的生产依赖。CI 包保留 14 天，正式版和 RC 发布为 GitHub Release 附件。CI 的 commit 标识使用 7 位短编号。

RC 的 N 按对应正式标签之后 main 的推送合并批次计数，包含构建失败的批次，同一提交的工作流重跑只计一次。main 应只接收 dev 的合并；直接向 main 推送也会计为一个集成批次。该规则同时支持 PR merge、squash、rebase 和本地快进合并后推送。Actions 在构建前创建 `integrations/main/<commit>` 轻量标签保存批次，计数独立于工作流日志保留时间；这些标签应随仓库保留。

仓库没有正式标签时，首次 main 构建会发布现有 0.2.2。也可在 GitHub Actions 中打开 **Build and release → Run workflow**，选择 `main` 分支、`stable`。已有的正式标签不会覆盖。普通发布使用 `auto`；版本号变更代表明确的正式发布意图。

RC 使用本项目约定的发布顺序：`0.2.2 → 0.2.2-rc1 → 0.2.2-rc2 → 0.2.3`，所以预发布渠道会将同基础版本的 RC 识别为更新。正式渠道不会安装 RC，也不会将已安装的 RC 降级为同基础版本正式包；等下一次正式版本号增加后继续更新。

## 一键安装与自动更新

README 中的一键命令下载最新正式版的安装脚本。支持 Debian 12/13、Ubuntu 22.04/24.04、x64/arm64 和 systemd，安装 Node.js 22、PostgreSQL 17 和应用服务。已有的 `winui_bbs` 数据库或账号会使安装停止，避免覆盖现有部署。

已下载发布包时，也可使用 `sudo bash install.sh /绝对路径/winui-bbs.tar.gz` 安装；依赖安装仍需网络连接。

| 位置                             | 用途                                     |
| -------------------------------- | ---------------------------------------- |
| `/opt/winui-bbs/current`         | 当前程序版本的符号链接                   |
| `/opt/winui-bbs/releases/`       | 各版本程序及依赖                         |
| `/opt/winui-bbs/shared/.env`     | 数据库连接、JWT 和加密密钥，仅 root 可读 |
| `/opt/winui-bbs/shared/data/`    | 上传文件                                 |
| `/opt/winui-bbs/shared/backups/` | 更新前的 PostgreSQL 自定义格式备份       |
| `/opt/winui-bbs/shared/update/`  | 更新请求及执行结果                       |

首次访问创建管理员后，在站点设置填写站点 URL。公网使用 HTTPS 反向代理到 4000 端口，并按部署环境配置防火墙。应用以专用非特权账号运行，更新服务由 systemd 单独执行。

自动更新默认关闭。启用后每小时按已保存渠道检查；也可以检查后点击“立即更新”。系统先下载新包、安装依赖，再停止应用、备份数据库、切换版本、重启并检查 `/api/health` 的版本。下载、依赖或备份失败会保留原程序；新版本健康检查失败会切回旧程序。数据库迁移不会自动逆向执行，恢复备份前须确认迁移兼容性；后台显示执行结果。

源码运行的 Windows/Linux 实例仍可检查更新和保存渠道；自动安装需要上述 systemd 服务。原有 `npm run dev` 和手动构建部署方式继续可用。

## 备份与恢复

```sh
sudo systemctl status winui-bbs winui-bbs-update.path
sudo journalctl -u winui-bbs -u winui-bbs-update.service -n 80
```

迁移或部署失败需要恢复数据库时，先停止应用，备份当前数据库，再由数据库管理员将 `shared/backups/` 中对应文件恢复到空数据库。更新 `shared/.env` 的 `DATABASE_URL` 并让 `current` 指向与备份匹配的程序版本，最后启动 `winui-bbs`。不要在仍有用户写入的数据库上直接覆盖恢复。

定期独立备份数据库、本地上传、对象存储及 `.env`。更新前数据库备份不包含上传和对象存储；需要保留 `MAIL_ENCRYPTION_KEY` / `STORAGE_ENCRYPTION_KEY` 才能读取原有加密凭据。旧版本目录和数据库备份保留供恢复，由服务器管理员按保留策略清理。
