# WinUI-BBS

[简体中文](README.md) | English

[![Version 0.2.1](https://img.shields.io/badge/version-0.2.1-0078D4)](package.json)
[![GPL-3.0-only](https://img.shields.io/badge/license-GPL--3.0--only-2d7d46)](LICENSE)

An open-source discussion forum with a **WinUI-style interface**, built with Vue 3, WinUIonWeb, Fastify and PostgreSQL. It combines rich posts, nested discussions, favorites and public user spaces with permission groups, content review and a visual administration panel. The interface is currently in Simplified Chinese.

[GitHub](https://github.com/tzhx12/WinUI-BBS) · [Report an issue](https://github.com/tzhx12/WinUI-BBS/issues) · [Configuration guide](docs/configuration.en.md)

## What's new in 0.2.1

- **Cross-platform icons:** Windows keeps its system Segoe Fluent Icons; other platforms load local Fluent UI System Icons for navigation, categories and controls.
- **Popular discussions:** posts appear directly below the heading, without category cards or a publish button.
- **Category posting:** publishing from a category page preselects that category while restoring the draft's title, body and images. Users can still change the selection.
- **Separate emoji allowance:** normal images follow the configured quota; all emoji share a separate limit of 1000 per post or individual reply. Emoji remain available when the normal-image quota is zero.

## Preview

**Community home · light theme**

![WinUI-BBS community home with isolated demo data](docs/images/community-light.png)

<details>
<summary>Show nested replies, emoji packs and dark administration</summary>

**Discussion · inline emoji, likes, favorites and nested replies**

![Post details with inline emoji and nested replies](docs/images/discussion-light.png)

**Editor · PipsPager emoji groups**

![The editor with its grouped emoji picker](docs/images/emoji-picker-light.png)

**My emoji packs · previews and personal ordering**

![Pinned community emoji and sortable personal pack previews](docs/images/emoji-packs-light.png)

**Post review · dark theme**

![WinUI-BBS post review with isolated demo data](docs/images/moderation-dark.png)

</details>

Screenshots show an isolated 0.2.0 demo instance, without real user data.

## Features

- **WinUI interface:** light and dark themes, accent colors, compact navigation, text scaling and responsive layouts, with Segoe Fluent Icons on Windows and Fluent UI System Icons elsewhere.
- **Rich posts and nested replies:** a Chinese Editor.js block editor, inline spoilers, local text and image drafts, configurable text and normal-image limits, a separate limit of 1000 emoji per body and independent pagination for main replies and child replies. Deleted replies do not renumber later floors.
- **Likes, favorites and user spaces:** persistent like states, split-button save and removal, a default favorite folder, public/private collections and public user profiles.
- **Categories and permissions:** category trees, reader and author levels, multiple groups, expiring memberships and separate management permissions.
- **Post review:** site-wide and category review settings, group exemptions or mandatory review, approval, rejection and account bans.
- **Community tools:** invitation codes and level rewards, daily check-ins, experience and titles, announcements, personal recycle bins and administrator deletion records. Temporary bans retain read-only access; administrator reply deletions notify affected authors.
- **Email and account security:** SMTP delivery, registration verification codes, limited password recovery, email-verified password changes and IMAP connection checks.
- **Grouped emoji:** PipsPager and wheel navigation, hover names, pack previews and personal ordering. Remote emoji sit inline with text; uploaded emoji retain their normal size. A pinned community pack is available in the corresponding editor to users with posting or reply permission, without image-library permission.
- **Media management:** personal storage and upload limits, Bmoji-compatible remote search and imports, remote packs exempt from the 150-image upload limit, and a configurable pack-quota switch. Administrators can search, filter and paginate images, with 50 per page by default.

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

## Upgrading to 0.2.1

1. Back up PostgreSQL, `apps/api/data/uploads/` and deployment configuration. If mail is configured, retain the existing `MAIL_ENCRYPTION_KEY` so saved credentials remain readable.
2. Update to the 0.2.1 code on `main`, then run `npm ci`, `npm run check` and `npm run build`.
3. Restart the API and frontend services. Upgrades from 0.2.0 have no new database migrations. For upgrades from 0.1.x, the API applies outstanding migrations in order (009–014); do not reinitialize the database.

Downloaded remote packs now count toward personal pack quotas by default. Existing packs are retained. Administrators can change this switch under **图床与表情 → 上传与远端设置**.

## Development

| Command                                | Purpose                          |
| -------------------------------------- | -------------------------------- |
| `npm run dev`                          | Start both development servers   |
| `npm run check`                        | Check types and icon mappings    |
| `npm run build`                        | Build both workspaces            |
| `npm run build:icons -w apps/web`      | Regenerate the icon bridge font  |
| `npm run test:integration -w apps/api` | Run PostgreSQL integration tests |
| `npm run format -w apps/web`           | Format the frontend              |

Integration tests create and remove isolated schemas; the database account needs permission to create schemas. Uploads are stored in `apps/api/data/uploads/`. Environment files, uploads and build output are ignored by Git.

Normal builds use the committed icon font. When adding icons, pair the Segoe codepoint with a Fluent SVG and regenerate the font. See the [icon compatibility maintenance guide (Chinese)](docs/icon-compatibility.md).

```text
apps/web/    Vue, WinUIonWeb and Editor.js frontend
apps/api/    Fastify API, SQL migrations and integration tests
docs/        Configuration guides and screenshots
licenses/    Third-party licenses and notices
```

See the [configuration guide](docs/configuration.en.md) for review precedence, group constraints, recycle-bin retention, view deduplication and media limits.

## Acknowledgements

Built with [WinUIonWeb](https://github.com/Furry-Xiyi/WinUIonWeb), [Vue](https://vuejs.org/), [Vue Router](https://router.vuejs.org/), [Editor.js](https://github.com/codex-team/editor.js), [DOMPurify](https://github.com/cure53/DOMPurify), [Fastify](https://fastify.dev/), [PostgreSQL](https://www.postgresql.org/), [Vite](https://vite.dev/) and [TypeScript](https://www.typescriptlang.org/).

Non-Windows icons come from the MIT-licensed [Fluent UI System Icons](https://github.com/microsoft/fluentui-system-icons). Windows references its system font; the project does not distribute Segoe font files.

The remote emoji feature references and integrates with [Bmoji](https://github.com/SomeOvO/Bmoji) services and compatible APIs. The in-app About page links to the related projects. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for license information.

## Contributing

Use [Issues](https://github.com/tzhx12/WinUI-BBS/issues) for bug reports and suggestions, or open a pull request. Include reproduction steps, your environment and relevant logs when reporting a problem.

## License

WinUI-BBS is licensed under **GPL-3.0-only**. See [LICENSE](LICENSE). Third-party components retain their own license terms.
