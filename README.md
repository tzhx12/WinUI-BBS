# WinUI-BBS

简体中文 | [English](README.en.md)

[![版本 0.2.0](https://img.shields.io/badge/version-0.2.0-0078D4)](package.json)
[![GPL-3.0-only](https://img.shields.io/badge/license-GPL--3.0--only-2d7d46)](LICENSE)

一个采用 **WinUI 风格**的开源论坛系统。使用 Vue 3、WinUIonWeb、Fastify 和 PostgreSQL，支持图文发帖、楼中楼讨论、收藏与个人空间，并提供用户组权限、内容审核和可视化管理后台。

[GitHub 仓库](https://github.com/tzhx12/WinUI-BBS) · [报告问题](https://github.com/tzhx12/WinUI-BBS/issues) · [使用与配置](docs/configuration.md)

## 界面预览

**社区首页 · 浅色主题**

![WinUI-BBS 社区首页，使用独立演示数据](docs/images/community-light.png)

<details>
<summary>查看楼中楼、表情包和深色管理后台</summary>

**帖子与楼中楼 · 行内表情、点赞与收藏**

![帖子详情、行内表情和楼中楼讨论](docs/images/discussion-light.png)

**编辑器 · PipsPager 表情分组**

![编辑器中的分组表情选择器](docs/images/emoji-picker-light.png)

**我的表情包 · 分组预览与个人排序**

![社区表情置顶、个人分组预览与排序](docs/images/emoji-packs-light.png)

**发帖审核 · 深色主题**

![WinUI-BBS 发帖审核界面，使用独立演示数据](docs/images/moderation-dark.png)

</details>

截图来自 0.2.0 的独立演示实例，不包含真实用户数据。

## 功能

- **WinUI 界面**：浅色与深色主题、强调色、紧凑导航、文字缩放和响应式布局。
- **图文与楼中楼**：Editor.js 中文块编辑器、行内剧透、本地文字与图片草稿、字数与图片限额；主回复与楼中楼独立翻页，删除后楼号不重排。
- **点赞、收藏与空间**：点赞状态持久保存，拆分按钮快速收藏或取消，支持默认收藏夹、公开或私密收藏夹及用户公开空间。
- **板块与权限**：树形板块、阅读与发帖等级、多用户组、临时成员关系，以及独立的管理权限。
- **发帖审核**：全站与板块审核开关、用户组免审核或强制审核规则，支持通过、拒绝和封禁处理。
- **社区管理**：邀请码及等级奖励、签到经验、等级头衔、站内公告、个人回收站与管理员删除记录；临时封禁账号保留只读访问，管理员删除回复会通知作者。
- **邮件与账号安全**：SMTP 发信、注册邮箱验证码、限次找回密码、邮箱验证改密，以及 IMAP 连接检查。
- **分组表情**：PipsPager 与滚轮切组、悬停名称、分组预览和个人排序；远端表情与文字同行，个人上传保持原大小。社区组固定置顶，有发帖或回复权限即可在对应区域使用，无须图床权限。
- **媒体管理**：个人容量与上传限额、Bmoji 兼容远端搜索和导入；远端每组不受 150 张限制，是否计入个人组数可配置。后台支持图片搜索、筛选与分页，默认每页 50 张。

## 快速开始

需要 **Node.js 22.12+**、**PostgreSQL 17+**，以及一个供应用使用的数据库和账号。

### 1. 获取项目

```sh
git clone https://github.com/tzhx12/WinUI-BBS.git
cd WinUI-BBS
npm ci
```

### 2. 配置数据库连接

复制 [apps/api/.env.example](apps/api/.env.example) 为 `apps/api/.env`，填写自己的数据库连接串，并设置私有的 JWT 密钥：

```dotenv
DATABASE_URL=postgresql://forum:your-password@127.0.0.1:5432/forum
JWT_SECRET=replace-with-a-long-random-secret
```

完整环境变量见示例文件。开发服务启动时会自动执行 SQL 迁移。

### 3. 启动

```sh
npm run dev
```

打开 <http://127.0.0.1:5173/>。首次访问空库时创建站点管理员；API 默认监听 <http://127.0.0.1:4000/>。

## 从 0.1.x 升级

1. 备份 PostgreSQL 数据库、`apps/api/data/uploads/` 和部署环境配置。使用邮件功能时，保留原 `MAIL_ENCRYPTION_KEY`，以便继续读取已加密凭据。
2. 更新到 `main` 分支的 0.2.0 代码，执行 `npm ci`、`npm run check` 和 `npm run build`。
3. 重启 API 与前端服务。API 会按顺序执行尚未应用的迁移（本版包含 010–014），无须重新初始化数据库。

远端下载组现在默认计入个人表情包组数限额；已有分组不会被移除。可在“图床与表情 → 上传与远端设置”调整此开关。

## 开发

| 命令                                   | 用途                       |
| -------------------------------------- | -------------------------- |
| `npm run dev`                          | 同时启动前后端开发服务     |
| `npm run check`                        | 检查前后端 TypeScript 类型 |
| `npm run build`                        | 构建前后端                 |
| `npm run test:integration -w apps/api` | 运行 PostgreSQL 集成测试   |
| `npm run format -w apps/web`           | 格式化前端代码             |

集成测试会创建并清理独立 schema，数据库账号需要创建 schema 的权限。上传文件存放在 `apps/api/data/uploads/`；环境配置、上传文件和构建产物均已忽略。

```text
apps/web/    Vue、WinUIonWeb、Editor.js 前端
apps/api/    Fastify API、SQL 迁移与集成测试
docs/        使用说明与界面截图
licenses/    第三方许可与声明
```

审核优先级、用户组约束、回收站保留期、浏览量去重和媒体限额等详细行为见[使用与配置](docs/configuration.md)。

## 开源致谢

感谢 [WinUIonWeb](https://github.com/Furry-Xiyi/WinUIonWeb)、[Vue](https://vuejs.org/)、[Vue Router](https://router.vuejs.org/)、[Editor.js](https://github.com/codex-team/editor.js)、[DOMPurify](https://github.com/cure53/DOMPurify)、[Fastify](https://fastify.dev/)、[PostgreSQL](https://www.postgresql.org/)、[Vite](https://vite.dev/) 和 [TypeScript](https://www.typescriptlang.org/)。

远端表情功能参考并对接 [Bmoji](https://github.com/SomeOvO/Bmoji) 的表情包服务与兼容接口。完整项目链接见应用内“关于”页，许可信息见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 参与项目

欢迎通过 [Issues](https://github.com/tzhx12/WinUI-BBS/issues) 反馈问题、提出建议，或提交 Pull Request。报告问题时请附上复现步骤、运行环境及相关日志。

## 开源许可

WinUI-BBS 采用 **GPL-3.0-only**，详见 [LICENSE](LICENSE)。第三方组件遵循各自的许可条款。
