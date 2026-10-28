# WinUI-BBS Configuration Guide

[Project home](../README.en.md) · [简体中文](configuration.md)

**Version 0.1.0** · GPL-3.0-only

WinUI-BBS is an open-source discussion forum with a Vue 3 frontend, WinUIonWeb controls, a Fastify API and PostgreSQL.

## Local development

1. Install Node.js 22.12 or newer and PostgreSQL 17 or newer.
2. Create a PostgreSQL database named `forum` and a login for the application.
3. Copy `apps/api/.env.example` to `apps/api/.env`, then set `DATABASE_URL` and a private `JWT_SECRET`.
4. Run `npm install`, then `npm run dev` from the repository root.
5. Open `http://127.0.0.1:5173`. The first visit creates the site administrator; subsequent visits use the sign-in form.

The API listens on `http://127.0.0.1:4000`. It applies SQL migrations in filename order on startup, records applied files in `schema_migrations`, and stores uploaded media in `apps/api/data/uploads`.

## Main features

- User IDs start at 1 and are paired with generated UUIDs.
- Users can belong to multiple permission groups. Temporary membership can expire.
- Ordinary and public groups cannot hold management permissions. Management groups retain posting, replying and personal-media access, and must have at least one management permission. These rules apply to group creation, permission edits and type changes, with database constraints protecting the stored configuration. Special and temporary group policies remain configurable.
- Experience comes from sign-in, posting and replies. Administrators can adjust levels, point values and non-overlapping level-title ranges.
- Categories form an editable tree with configurable icons, optional navigation badges and separate reader and author level thresholds.
- Administrators can ban users for 30 minutes to 1095 days, or lift a ban early. Bans block login and authenticated requests until expiry; permanent account suspension remains a separate setting.
- Editor.js stores post bodies as JSON, uses Chinese interface text and includes an inline spoiler tool.
- Image uploads, emoji packs and the site icon are managed in the admin interface.
- Registration can be closed, open to everyone, or limited to invitations. Administrators create single-use or reusable codes; level rules grant each eligible user a reward once. Users open **我的邀请码** beside the group information in their dashboard to manage invitation links. The configured site URL is used when copying invitation and image links.
- In **邀请码管理 → 等级奖励**, rules can be enabled, disabled or deleted. Deleting a rule stops future rewards and keeps already issued invitation codes available.
- Users can upload an avatar, change their login username and edit their nickname from dashboard dialogs. Usernames must be unique without regard to letter case. A successful username change starts a 180-day waiting period; active members of management groups are exempt. Failed requests and saving the same username do not use the allowance. Nicknames can be edited independently and appear in the title bar, profiles and post bylines. Avatar uploads follow the user's image and storage limits. Existing avatars remain in personal uploads; the currently active avatar cannot be deleted. Changing a login username keeps the nickname, UID and other account data intact.

## Posts and personal recycle bin

The user dashboard can move an author's own posts into **回收站**. Only that author can list or read recycled posts, including their existing replies; they are hidden from public feeds and admin post management. Restoring a post preserves its original moderation status, likes and replies and does not grant posting experience again.

The default retention is 30 days. Change it under **站点设置 → 回收站**; new deletions use the configured duration and existing expiration times stay fixed. Expired posts become inaccessible immediately. The API removes expired records on startup and every hour while running. Uploaded images remain separately managed in personal media.

The `posts.set_reader_level` group permission controls setting a positive minimum reader level. Management groups receive it initially; ordinary groups do not. Both the compose screen and API enforce this permission.

Post views are counted once per account, or once per anonymous browser identified by the signed `forum-visitor` cookie. Repeated reads and like toggles do not add views. A new browser or cleared visitor cookie represents a new anonymous visitor; signed-in and anonymous identities are separate. Existing historical view totals remain unchanged, with deduplication applied to subsequent visits.

In **发帖管理**, hiding a post removes it from home, popular, search and category lists while retaining access through its URL, subject to reader-level rules. Administrator deletion moves a post into **删除记录**, outside the author's recycle bin. Only users with `posts.manage` can restore it. Administrator-deleted posts have no automatic expiry and retain their original publication or review status.

## Post review and notifications

Enable **审核设置 → 全站发帖审核** to queue new posts for review. Individual categories can also require review in **板块结构**. Existing posts and pending queues keep their state when these settings change.

- `posts.require_review` always requires review, including when another group grants an exemption.
- `posts.bypass_review` exempts other users from both site and category review requirements.
- Other users require review when either the site or the selected category requires it.
- `posts.review` grants access to **发帖审核**, including reading the body, author, creation time, current groups and submission IP. Historical posts have no recorded submission IP. Reviewers can approve, reject with a reason, or reject and temporarily ban the author. Rejection and bans create private notifications. Bans retain the existing login restriction until expiry.

The built-in **站点管理** group starts with `posts.review` and `posts.bypass_review`. New management groups receive the management permissions selected for them. A user with only `posts.manage` cannot publish pending or rejected posts through the post-management API. Pending and rejected posts are visible to their author through their URL and to authorized reviewers in the review interface.

The group-permission migration removes management grants from existing ordinary/public groups, adds the three basic user permissions to management groups, and converts an existing management group with no management permission to a special group while preserving its memberships and capabilities. Removed grants and type conversions are recorded in the management audit log.

Administrators with `settings.manage` use **公告与通知** to send announcements to all current active accounts, an active group's members, or one UID. Recipients use **站内通知** to read announcements and review decisions, mark individual messages or all messages as read, and load older messages. The navigation badge refreshes every 30 seconds. New registrations do not receive earlier announcements.

## Uploads and emoji packs

In **图床与表情 → 上传与远端设置**, configure default storage and upload limits. Defaults are 1 GiB per user, 20 MiB per image, 20 uploaded emoji packs, 150 images per pack and 3 MiB per emoji image. Group settings can override individual limits; when several active groups specify a limit, the largest configured value applies. Unchecked overrides inherit the site default. The `media.use` permission controls personal image management and uploads; ordinary members receive it by default.

**我的图片** manages a user's uploads, personal emoji packs and downloaded remote packs. Private packs appear only in their owner's editor picker. Deleting an owned image replaces its existing post and reply references with the Akari placeholder at `apps/web/public/deleted-image.png`; other images and captions remain intact. This also applies when deleting an uploaded personal emoji pack. Active avatars and the site icon remain protected. The placeholder was generated with CCTQ using the supplied reference image.

Remote downloads are disabled initially. Enable them and configure the source page and compatible [Bmoji](https://github.com/SomeOvO/Bmoji) API endpoint. The supplied service supports visual search, preview and static/GIF imports. Downloads are stored locally once per API source, pack and version; users share cached files through separate collection records. Cached downloads do not consume personal storage or uploaded-pack allowances. Removing a collected pack keeps the cache and existing post images available.

## About and open-source credits

Open **关于** from the bottom of the navigation pane, above **外观设置** or **管理后台**. The page introduces WinUI-BBS, displays version 0.1.0 and provides links to its open-source dependencies. It is available to visitors and signed-in users.

The project version comes from the root `package.json`. Site administrators can configure their own community name independently.

## Frontend

The application uses WinUIonWeb's `TitleBar` and responsive `NavigationView` as its shell. Its `Frame` runs entrance transitions between sections and a drill-in transition when opening posts. Forms, dialogs, menus, lists, the category tree and progress indicators use the library's controls and theme resources. Light and dark themes are available from the title bar.

The hash routes support direct links to posts, categories and each administration page. The admin navigation shows the sections granted by the current user's groups. Editor.js handles rich text, inline spoilers, uploaded images and separate emoji blocks.

`npm run check` checks both workspaces; `npm run build` builds the API and frontend. Run `npm run format -w apps/web` to format the frontend. An isolated frontend test instance can point its Vite proxy at a separate API using `FORUM_API_URL`.

Run `npm run test:integration -w apps/api` to verify registration, invitations, media ownership and quotas, shared remote caching, category settings, timed bans, review permissions, notifications, deleted-image placeholders and recycle-bin isolation against PostgreSQL. The tests use the configured database, create temporary schemas and remove them after the run; the database role needs permission to create schemas.

WinUI-BBS and WinUIonWeb are GPL-3.0-only. Editor.js is Apache-2.0. License texts and third-party notices are collected in `LICENSE`, `THIRD_PARTY_NOTICES.md` and `licenses/`.
