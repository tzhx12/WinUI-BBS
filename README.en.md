# WinUI-BBS

[简体中文](README.md) | English

[![Version 0.2.2](https://img.shields.io/badge/version-0.2.2-0078D4)](package.json)
[![GPL-3.0-only](https://img.shields.io/badge/license-GPL--3.0--only-2d7d46)](LICENSE)

An open-source discussion forum with a **WinUI-style interface**, built with Vue 3, WinUIonWeb, Fastify and PostgreSQL. It provides rich discussions, user spaces, fine-grained permissions and a visual administration panel. The interface is currently in Simplified Chinese.

[GitHub](https://github.com/tzhx12/WinUI-BBS) · [Report an issue](https://github.com/tzhx12/WinUI-BBS/issues) · [Configuration guide](docs/configuration.en.md)

## Features

### Community discussions

The Chinese block editor supports text, images, emoji, draft restoration, nested replies and content that unlocks after a reply, like or follow. Users can like posts, save favorites and follow authors; the home feed prioritizes unread posts from followed authors.

### User spaces and permissions

Users can manage profiles, avatars, follows and favorite folders, and publish a public space. Category trees, reader and author levels, groups and expiring memberships control access. Management permissions are split by capability, and the administration menu follows the current account's permissions.

### Review and administration

Administrators can require review site-wide or by category, grant group-based exemptions or mandatory review, and process approvals, rejections and bans. Community tools include invitation codes, check-in rewards, level titles, in-site notifications, recycle bins and management audit records.

### Media, emoji and storage

Users and administrators can manage images, personal emoji packs, a community pack and the site icon. Remote emoji support search, previews, static/GIF imports and inline insertion.

Local and S3-compatible storage support capacity monitoring, automatic switching, low-space alerts and cleanup of the oldest ordinary images. Emoji packs, avatars and the site icon are protected from automatic cleanup. Administrators can configure quotas, storage priority and cleanup batches.

### Appearance and cross-platform UI

The interface supports light and dark themes, accent colors, compact navigation, text scaling and responsive layouts. Windows uses system Segoe Fluent Icons; other platforms use the bundled Fluent UI System Icons.

### Email and account security

The server supports SMTP delivery, registration email verification, rate-limited password recovery, email-verified password changes and IMAP connection checks. Mail and object-storage credentials are encrypted with server-side keys.

## Preview

![WinUI-BBS community home with isolated demo data](docs/images/community-light.png)

<details>
<summary>Show discussions, emoji and administration</summary>

![Post details and nested replies](docs/images/discussion-light.png)

![Grouped emoji picker](docs/images/emoji-picker-light.png)

![Personal emoji packs](docs/images/emoji-packs-light.png)

![Post review in the dark theme](docs/images/moderation-dark.png)

</details>

## Quick start

Install **Node.js 22.12+** and **PostgreSQL 17+**, then create a database and account for the application.

```sh
git clone https://github.com/tzhx12/WinUI-BBS.git
cd WinUI-BBS
npm ci
```

Copy [apps/api/.env.example](apps/api/.env.example) to `apps/api/.env`. At minimum, set the database connection and a private JWT secret:

```dotenv
DATABASE_URL=postgresql://forum:your-password@127.0.0.1:5432/forum
JWT_SECRET=replace-with-a-long-random-secret
```

Start the development services:

```sh
npm run dev
```

Open <http://127.0.0.1:5173/>. The API listens on <http://127.0.0.1:4000/> by default. The first visit to an empty database creates the site administrator, and the API applies pending SQL migrations automatically.

## Development

| Command                                | Purpose                          |
| -------------------------------------- | -------------------------------- |
| `npm run dev`                          | Start both development servers   |
| `npm run check`                        | Check types and icon mappings    |
| `npm run build`                        | Build both workspaces            |
| `npm run test:integration -w apps/api` | Run PostgreSQL integration tests |
| `npm run format -w apps/web`           | Format the frontend              |

Integration tests create and remove an isolated database schema; the test account needs permission to create schemas. Uploads are stored in `apps/api/data/uploads/`; environment files, uploads and build output are ignored.

Project structure:

```text
apps/web/    Vue, WinUIonWeb and Editor.js frontend
apps/api/    Fastify API, SQL migrations and integration tests
docs/        Configuration guides and screenshots
licenses/    Third-party licenses and notices
```

See the [configuration guide](docs/configuration.en.md) for permissions, review, media limits, storage policies and deployment details.

## Acknowledgements

Built with [WinUIonWeb](https://github.com/Furry-Xiyi/WinUIonWeb), [Vue](https://vuejs.org/), [Vue Router](https://router.vuejs.org/), [Editor.js](https://github.com/codex-team/editor.js), [DOMPurify](https://github.com/cure53/DOMPurify), [Fastify](https://fastify.dev/), [PostgreSQL](https://www.postgresql.org/), [Vite](https://vite.dev/) and [TypeScript](https://www.typescriptlang.org/).

Non-Windows icons come from the MIT-licensed [Fluent UI System Icons](https://github.com/microsoft/fluentui-system-icons). The remote emoji feature references [Bmoji](https://github.com/SomeOvO/Bmoji) and compatible APIs. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for license information.

## Contributing

Use [Issues](https://github.com/tzhx12/WinUI-BBS/issues) for bug reports and suggestions, or open a pull request. Include reproduction steps, your environment and relevant logs.

## License

WinUI-BBS is licensed under **GPL-3.0-only**. See [LICENSE](LICENSE). Third-party components retain their own license terms.
