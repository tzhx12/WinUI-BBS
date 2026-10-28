# WinUI-BBS

简体中文 | [English](README.en.md)

[![版本 0.1.0](https://img.shields.io/badge/version-0.1.0-0078D4)](package.json)
[![GPL-3.0-only](https://img.shields.io/badge/license-GPL--3.0--only-2d7d46)](LICENSE)

一个采用 **WinUI 风格**的开源论坛系统。使用 Vue 3、WinUIonWeb、Fastify 和 PostgreSQL，提供图文讨论、用户组权限、内容审核与可视化管理后台。

[GitHub 仓库](https://github.com/tzhx12/WinUI-BBS) · [报告问题](https://github.com/tzhx12/WinUI-BBS/issues) · [使用与配置](docs/configuration.md)

## 界面预览

**社区首页 · 浅色主题**

![WinUI-BBS 社区首页，使用独立演示数据](docs/images/community-light.png)

<details>
<summary>查看发帖审核界面与深色主题</summary>

![WinUI-BBS 发帖审核界面，使用独立演示数据](docs/images/moderation-dark.png)

</details>

## 功能

- **WinUI 界面**：浅色与深色主题、强调色、紧凑导航、文字缩放和响应式布局。
- **图文讨论**：Editor.js 中文块编辑器，支持图片、引用、列表、代码、剧透和表情包。
- **板块与权限**：树形板块、阅读与发帖等级、多用户组、临时成员关系，以及独立的管理权限。
- **发帖审核**：全站与板块审核开关、用户组免审核或强制审核规则，支持通过、拒绝和封禁处理。
- **社区管理**：邀请码及等级奖励、签到经验、等级头衔、站内公告、个人回收站与管理员删除记录。
- **图床与表情**：个人上传限额、表情包管理，以及基于 Bmoji 兼容接口的远端搜索与导入。

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
