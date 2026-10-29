# WinUI-BBS

[简体中文](README.md) | English

[![Version 0.1.0](https://img.shields.io/badge/version-0.1.0-0078D4)](package.json)
[![GPL-3.0-only](https://img.shields.io/badge/license-GPL--3.0--only-2d7d46)](LICENSE)

An open-source discussion forum with a **WinUI-style interface**, built with Vue 3, WinUIonWeb, Fastify and PostgreSQL. It brings rich posts, permission groups, content review and a visual administration panel together. The interface is currently in Simplified Chinese.

[GitHub](https://github.com/tzhx12/WinUI-BBS) · [Report an issue](https://github.com/tzhx12/WinUI-BBS/issues) · [Configuration guide](docs/configuration.en.md)

## Preview

**Community home · light theme**

![WinUI-BBS community home with isolated demo data](docs/images/community-light.png)

<details>
<summary>Show post review and the dark theme</summary>

![WinUI-BBS post review with isolated demo data](docs/images/moderation-dark.png)

</details>

## Features

- **WinUI interface:** light and dark themes, accent colors, compact navigation, text scaling and responsive layouts.
- **Rich discussions:** a Chinese Editor.js block editor with images, quotes, lists, code, spoilers and emoji packs.
- **Categories and permissions:** category trees, reader and author levels, multiple groups, expiring memberships and separate management permissions.
- **Post review:** site-wide and category review settings, group exemptions or mandatory review, approval, rejection and account bans.
- **Community tools:** invitation codes and level rewards, daily check-ins, experience and titles, announcements, personal recycle bins and administrator deletion records.
- **Email and account security:** SMTP delivery, registration verification codes, limited password recovery, email-verified password changes and IMAP connection checks.
- **Images and emoji:** personal upload quotas, emoji-pack management, and remote browsing and imports through a Bmoji-compatible API.

Unsent text and images stay in browser drafts until publication. Configurable content limits, paginated replies, public/private favorite folders and public user spaces support longer discussions. Temporarily banned accounts retain read-only access.

## Quick start

Install **Node.js 22.12+** and **PostgreSQL 17+**, then create a database and account for the application.

### 1. Get the source

```sh
git clone https://github.com/tzhx12/WinUI-BBS.git
cd WinUI-BBS
npm ci
```

### 2. Configure the database connection

Copy [apps/api/.env.example](apps/api/.env.example) to `apps/api/.env`. Set your database connection string and a private JWT secret:

```dotenv
DATABASE_URL=postgresql://forum:your-password@127.0.0.1:5432/forum
JWT_SECRET=replace-with-a-long-random-secret
```

The example file lists the remaining environment variables. SQL migrations run automatically when the API starts.

### 3. Start the app

```sh
npm run dev
```

Open <http://127.0.0.1:5173/>. The first visit to an empty database creates the site administrator. The API listens on <http://127.0.0.1:4000/> by default.

## Development

| Command                                | Purpose                          |
| -------------------------------------- | -------------------------------- |
| `npm run dev`                          | Start both development servers   |
| `npm run check`                        | Type-check the API and frontend  |
| `npm run build`                        | Build both workspaces            |
| `npm run test:integration -w apps/api` | Run PostgreSQL integration tests |
| `npm run format -w apps/web`           | Format the frontend              |

Integration tests create and remove isolated schemas; the database account needs permission to create schemas. Uploads are stored in `apps/api/data/uploads/`. Environment files, uploads and build output are ignored by Git.

```text
apps/web/    Vue, WinUIonWeb and Editor.js frontend
apps/api/    Fastify API, SQL migrations and integration tests
docs/        Configuration guides and screenshots
licenses/    Third-party licenses and notices
```

See the [configuration guide](docs/configuration.en.md) for review precedence, group constraints, recycle-bin retention, view deduplication and media limits.

## Acknowledgements

Built with [WinUIonWeb](https://github.com/Furry-Xiyi/WinUIonWeb), [Vue](https://vuejs.org/), [Vue Router](https://router.vuejs.org/), [Editor.js](https://github.com/codex-team/editor.js), [DOMPurify](https://github.com/cure53/DOMPurify), [Fastify](https://fastify.dev/), [PostgreSQL](https://www.postgresql.org/), [Vite](https://vite.dev/) and [TypeScript](https://www.typescriptlang.org/).

The remote emoji feature references and integrates with [Bmoji](https://github.com/SomeOvO/Bmoji) services and compatible APIs. The in-app About page links to the related projects. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for license information.

## Contributing

Use [Issues](https://github.com/tzhx12/WinUI-BBS/issues) for bug reports and suggestions, or open a pull request. Include reproduction steps, your environment and relevant logs when reporting a problem.

## License

WinUI-BBS is licensed under **GPL-3.0-only**. See [LICENSE](LICENSE). Third-party components retain their own license terms.
