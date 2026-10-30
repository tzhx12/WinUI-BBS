# WinUI-BBS

简体中文 | [English](README.en.md)

[![版本 0.2.2](https://img.shields.io/badge/version-0.2.2-0078D4)](package.json)
[![GPL-3.0-only](https://img.shields.io/badge/license-GPL--3.0--only-2d7d46)](LICENSE)

一个采用 **WinUI 风格**的开源论坛系统。项目使用 Vue 3、WinUIonWeb、Fastify 和 PostgreSQL，提供图文讨论、用户空间、细粒度权限和可视化管理后台。界面默认使用简体中文。

[GitHub 仓库](https://github.com/tzhx12/WinUI-BBS) · [报告问题](https://github.com/tzhx12/WinUI-BBS/issues) · [使用与配置](docs/configuration.md)

## 功能

### 社区讨论

支持中文块编辑器、图片和表情、草稿恢复、剧透与内容锁定。帖子、主评论和楼中楼分别分页，删除评论不会重新编号；点赞、收藏、关注和浏览记录会持久保存。

### 用户空间与权限

用户可以维护个人资料、头像、关注列表和收藏夹，并公开自己的空间。树形板块、阅读等级、发帖等级、用户组和临时成员关系共同控制内容访问。管理权限按功能拆分，后台菜单会按当前账号权限显示。

### 内容审核与管理

管理员可以配置全站或板块审核，按用户组设置免审或强制审核，并处理通过、拒绝和封禁。公告、审核结果、管理员删除记录和存储提醒都通过站内通知送达；临时封禁账号仍可只读浏览。

### 图床、表情与存储

用户和管理员可以管理图片、个人表情包、社区表情包和站点图标。远端表情支持搜索、预览、静态/GIF 导入和行内插入。

管理后台的“图床与表情 → 存储设置”显示服务器磁盘、本地存储和兼容 S3 对象存储的剩余容量。管理员可以选择优先后端、设置本地上限、对象存储配额和回收批次；优先后端空间不足时自动切换。存储达到 95% 会通知拥有图床管理权限的管理员；所有后端都满时，系统按时间回收普通图片并替换正文引用。表情包、头像和站点图标不会自动回收。

### 外观与跨系统界面

支持浅色/深色主题、强调色、紧凑导航、文字缩放和响应式布局。Windows 使用系统 Segoe Fluent Icons，其他系统使用项目内置的 Fluent UI System Icons。

### 邮件与账号安全

支持 SMTP 发信、注册邮箱验证、限次找回密码、邮箱验证改密和 IMAP 连接检查。邮件及对象存储凭据使用服务端密钥加密保存。

## 界面预览

![WinUI-BBS 社区首页，使用独立演示数据](docs/images/community-light.png)

更多帖子、楼中楼、表情包和管理后台截图见 [使用与配置](docs/configuration.md)。截图使用独立演示数据，不包含真实用户资料。

## 快速开始

需要 **Node.js 22.12+**、**PostgreSQL 17+**，以及一个供应用使用的数据库和账号。

```sh
git clone https://github.com/tzhx12/WinUI-BBS.git
cd WinUI-BBS
npm ci
```

复制 [apps/api/.env.example](apps/api/.env.example) 为 `apps/api/.env`，至少填写数据库连接和 JWT 密钥：

```dotenv
DATABASE_URL=postgresql://forum:your-password@127.0.0.1:5432/forum
JWT_SECRET=replace-with-a-long-random-secret
```

启动开发服务：

```sh
npm run dev
```

打开 <http://127.0.0.1:5173/>。API 默认监听 <http://127.0.0.1:4000/>；首次访问空数据库时创建站点管理员。API 启动时会自动执行尚未应用的 SQL 迁移。

## 开发

| 命令                                   | 用途                     |
| -------------------------------------- | ------------------------ |
| `npm run dev`                          | 同时启动前后端开发服务   |
| `npm run check`                        | 检查类型和图标映射       |
| `npm run build`                        | 构建前后端               |
| `npm run test:integration -w apps/api` | 运行 PostgreSQL 集成测试 |
| `npm run format -w apps/web`           | 格式化前端代码           |

集成测试会创建并清理独立数据库 schema，测试账号需要具备创建 schema 的权限。上传文件保存在 `apps/api/data/uploads/`；环境文件、上传文件和构建产物均已忽略。

项目结构：

```text
apps/web/    Vue、WinUIonWeb、Editor.js 前端
apps/api/    Fastify API、SQL 迁移和集成测试
docs/        使用说明和界面截图
licenses/    第三方许可与声明
```

详细的权限、审核、媒体限额、存储策略和部署说明见[使用与配置](docs/configuration.md)。

## 开源致谢

感谢 [WinUIonWeb](https://github.com/Furry-Xiyi/WinUIonWeb)、[Vue](https://vuejs.org/)、[Vue Router](https://router.vuejs.org/)、[Editor.js](https://github.com/codex-team/editor.js)、[DOMPurify](https://github.com/cure53/DOMPurify)、[Fastify](https://fastify.dev/)、[PostgreSQL](https://www.postgresql.org/)、[Vite](https://vite.dev/) 和 [TypeScript](https://www.typescriptlang.org/)。

非 Windows 图标来自 MIT 许可的 [Fluent UI System Icons](https://github.com/microsoft/fluentui-system-icons)。远端表情功能参考并对接 [Bmoji](https://github.com/SomeOvO/Bmoji) 的兼容接口。完整许可信息见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 参与项目

欢迎通过 [Issues](https://github.com/tzhx12/WinUI-BBS/issues) 反馈问题、提出建议或提交 Pull Request。请附上复现步骤、运行环境和相关日志。

## 开源许可

WinUI-BBS 采用 **GPL-3.0-only**，详见 [LICENSE](LICENSE)。第三方组件遵循各自的许可条款。
