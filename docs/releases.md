# 构建、发布与更新

在管理后台的“站点设置 → 系统更新”检查新版本。Releases 只接收正式版；Pre-releases 接收正式版及 RC。Alpha 包仅供 CI 验证，不进入自动更新渠道。

## 发布一个版本

当前正式版为 **0.3.0**。未特别指定时，下一正式版取当前正式版的下一个次版本并将修订号归零：`0.3.0 → 0.4.0 → 0.5.0`。

| 操作                        | Actions 结果              | 0.3.0 发布后的示例    |
| --------------------------- | ------------------------- | --------------------- |
| 推送 dev                    | Artifacts 中的 Alpha 构建 | `0.4.0-Alpha.5939d46` |
| dev 合并 main，项目版本不变 | GitHub Pre-release        | `0.4.0-rc.1`          |
| 设定正式版本后合并 main     | GitHub Release            | `0.4.0`               |

版本遵循 SemVer：`0.3.0 < 0.4.0-Alpha.5939d46 < 0.4.0-rc.1 < 0.4.0-rc.2 < 0.4.0-rc.10 < 0.4.0`。预发布号以**下一正式版**为基础，阶段与编号用点号分隔；RC 编号按数值比较。Alpha 的 commit 标识使用 7 位短编号，仅标识构建，不表示提交先后。正式渠道可从 RC 升至对应正式版。

### 指定目标与正式发布

如果下一正式版不是默认的次版本，可在 dev 执行：

```sh
npm run version:next -- 1.0.0
```

此命令只在根目录 `package.json` 的 `release.nextVersion` 中记录目标，不触发正式发布；随后 Alpha 和 RC 使用 `1.0.0` 为基础。删除该字段恢复默认规则。

准备正式发布时，在 dev 执行：

```sh
npm run version:set -- 0.4.0
```

根目录、API/Web workspace 和锁文件版本一起更新；已达成的显式目标同时清除。提交并合并到 main 后，Actions 发布设定的正式版本。正常使用 `auto`；`workflow_dispatch` 的 `stable` 可补发尚不存在的当前正式版，不覆盖已有正式标签。Alpha / RC 后缀只写入构建工作区，不回写分支。

### RC 批次与发布验收

RC 的 N 按**上一个正式标签之后** main 的集成推送批次计数，包含构建失败的批次，同一提交的工作流重跑只计一次。发布正式版后重新从 1 开始。main 应接收 dev 的合并；直接向 main 推送也会计为一个批次。PR merge、squash、rebase 和本地快进合并均适用。Actions 在构建前创建 `integrations/main/<commit>` 轻量标签保存批次；这些标签应随仓库保留。

所有包经过类型检查、图标检查、版本/更新脚本测试、PostgreSQL 17 集成测试及前后端构建。main 发布前还在 Ubuntu 24.04 上实际安装并验证 systemd 站点和独立更新服务。`winui-bbs.tar.gz` 包含编译好的前端/API、迁移、源码、锁文件和许可证；安装时只安装 API 生产依赖。CI 包保留 14 天，正式版和 RC 发布为 GitHub Release 附件。

此前错误命名的 `0.2.2-rc1` 已更正为 `0.3.0-rc.1`；旧版本命名不再生成。已安装旧格式版本的实例仍可升级到 0.3.0 正式版。

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
