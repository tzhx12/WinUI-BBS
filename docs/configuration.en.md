# WinUI-BBS Configuration Guide

[Project home](../README.en.md) · [简体中文](configuration.md)

**Version 0.2.2** · GPL-3.0-only

WinUI-BBS is an open-source discussion forum with a Vue 3 frontend, WinUIonWeb controls, a Fastify API and PostgreSQL.

## Local development

1. Install Node.js 22.12 or newer and PostgreSQL 17 or newer.
2. Create a PostgreSQL database named `forum` and a login for the application.
3. Copy `apps/api/.env.example` to `apps/api/.env`, then set `DATABASE_URL` and a private `JWT_SECRET`.
4. Run `npm install`, then `npm run dev` from the repository root.
5. Open `http://127.0.0.1:5173`. The first visit creates the site administrator; subsequent visits use the sign-in form.

The API listens on `http://127.0.0.1:4000`. It applies SQL migrations in filename order on startup, records applied files in `schema_migrations`, and stores uploaded media in `apps/api/data/uploads`.

## Email verification and passwords

The administration navigation groups pages under **用户与注册** (users and registration), **内容管理** (content), and **站点配置** (site configuration). Parent items expand their subtrees; only a child item navigates to a page. Groups and children are filtered by effective permissions. The pane toggle is on the left of the TitleBar: it expands or collapses the desktop navigation and opens or closes the drawer on narrow screens.

Configure SMTP delivery and optional IMAP connection checks in **站点配置 → 发信设置**. SMTP sends mail; IMAP checks the receiving connection. SMTP supports direct TLS and STARTTLS. Save the configuration before sending a test message. Saved passwords are encrypted and are never returned to the frontend; an empty password field retains the existing secret.

Set `MAIL_ENCRYPTION_KEY` in `apps/api/.env` before saving mail credentials. Generate a 32-byte Base64 key with the command below, store it in that environment variable, and retain the same key when moving or restoring the database:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Credentials are encrypted with AES-256-GCM in the database. Real mail addresses, hosts and secrets belong in local deployment configuration, never in source files or committed screenshots.

Enable registration email verification in **用户与注册 → 注册管理**. Codes expire after **60 minutes** by default and can be used only once. Five wrong attempts invalidate a code. Registration, password-change and recovery mail share a per-email send interval of at least **60 seconds**.

The sign-in dialog includes password recovery. A recovery link expires after **30 minutes** by default and can be requested **once per day** per email, using the site timezone. Links use the configured site URL, which must be reachable by the recipient. A successful reset invalidates all previous sessions.

Users can change their password from the dashboard after verifying a code sent to their account email. Passwords must have 10–128 characters; successful changes are limited to **once per 60 seconds** by default. The current session receives a new token and other previous sessions become invalid.

Code expiry, mail interval, recovery availability, link expiry, daily request limit and password-change interval are configurable in registration management. Registration verification starts disabled so installations without a mail service retain their existing registration behavior. These changes do not require existing accounts to verify email before signing in.

## Main features

On phones, the title bar hides the site name and subtitle while keeping the logo, navigation, search, theme and account controls visible. Search requires a nonblank keyword of 1–120 characters. Press Enter to search on mobile; blank submissions do not navigate, blank search URLs show a prompt, and the API rejects blank keywords.

- User IDs start at 1 and are paired with generated UUIDs.
- Users can belong to multiple permission groups. Temporary membership can expire.
- Ordinary and public groups cannot hold management permissions. Management groups retain posting, replying and personal-media access, and must have at least one management permission. These rules apply to group creation, permission edits and type changes, with database constraints protecting the stored configuration. Special and temporary group policies remain configurable.
- Experience comes from sign-in, posting and replies. Administrators can adjust levels, point values and non-overlapping level-title ranges.
- Categories form an editable tree with configurable icons, optional navigation badges and separate reader and author level thresholds.
- Administrators can ban users for 30 minutes to 1095 days, or lift a ban early. Temporarily banned accounts can sign in, browse at the baseline reader level (Lv.1), and view their own profile, posts, folders and images. All writes and administration access are blocked until expiry. Permanent suspension remains a separate state that prevents login.
- Editor.js stores post bodies as JSON, uses Chinese interface text and includes an inline spoiler tool.
- Image uploads, emoji packs and the site icon are managed in the admin interface.
- Registration can be closed, open to everyone, or limited to invitations. Administrators create single-use or reusable codes; level rules grant each eligible user a reward once. Users open **我的邀请码** beside the group information in their dashboard to manage invitation links. The configured site URL is used when copying invitation and image links.
- In **邀请码管理 → 等级奖励**, rules can be enabled, disabled or deleted. Deleting a rule stops future rewards and keeps already issued invitation codes available.
- Users can upload an avatar, change their login username and edit their nickname from dashboard dialogs. Usernames must be unique without regard to letter case. A successful username change starts a 180-day waiting period; active members of management groups are exempt. Failed requests and saving the same username do not use the allowance. Nicknames can be edited independently and appear in the title bar, profiles and post bylines. Avatar uploads follow the user's image and storage limits. Existing avatars remain in personal uploads; the currently active avatar cannot be deleted. Changing a login username keeps the nickname, UID and other account data intact.

## Content limits, pagination and local drafts

Administrators with `settings.manage` configure **内容管理 → 发帖与回复设置**. Both the editor and API enforce the limits for new submissions; existing content is retained.

| Setting              | Default | Allowed range |
| -------------------- | ------- | ------------- |
| Post body characters | 20000   | 1–100000      |
| Post normal images   | 15      | 0–50          |
| Reply characters     | 1000    | 1–10000       |
| Reply normal images  | 5       | 0–20          |
| Replies per page     | 20      | 1–100         |

Visible Unicode characters count toward the body limit, including nested lists and captions; formatting markup does not. Image limits apply only to normal images. Uploaded emoji, remote inline emoji and community emoji share a fixed limit of 1000 per post or individual reply, including child replies. Each insertion counts, including repeated emoji. Replies are paginated by the server, including in recycle-bin details.

Unsent bodies, titles, categories and selected image blobs stay in the current browser's IndexedDB, isolated by user and reply target. Refreshing or revisiting restores the draft; clearing site data removes it. Images use local previews until the post or reply is submitted. Validation or storage failures roll back files and database records and preserve the draft. Successful submission clears the draft. New attachments are limited to 100 MiB per submission and the user's media allowance.

Publishing from a category page preselects that category instead of the draft's saved category, while restoring the title, body and images. Users can still change the selection. General posting entry points restore the saved category, or select the first allowed category without a draft. Categories above the user's author level cannot be preselected.

Direct library uploads from **我的图片** start disabled. Administrators can enable them in the same settings page. Avatar and emoji-pack uploads keep their dedicated entry points.

## Replies, nested replies and deletion

Select **回复** below a reply to open its nested-reply composer. Replying to a nested reply includes its author's name. Each thread shows five nested replies per page, with previous/next controls and direct page-number navigation; changing a nested page does not change the post's main reply page. Main and nested replies receive monotonic floor numbers such as `第 12 楼` and `第 12 楼-3 层`. Deleted replies hide their floor label, but the number is never reused and existing numbers are never renumbered.

Ordinary users see a delete action only on their own replies and can delete only content they wrote. Users with `posts.manage` can delete any reply. Reply deletion is permanent and does not use the recycle bin. When deleting a main reply that has nested replies, an administrator can keep those replies and show **该回复已被管理员删除**, or permanently delete the entire thread. Administrator deletions notify affected authors and are recorded in the moderation audit log; author deletions do not generate moderator notices or audit events. Removing the last nested reply also removes an otherwise empty deleted-reply placeholder.

## Following and locked content

Choose **关注** beside a post's author or on the right of a public user space's profile card to follow them. **用户后台 → 我的关注** (`/account/following`) lists followed users, links to their public spaces and lets you unfollow. Home keeps pinned posts first, then prioritizes unread posts from followed authors. Opening a post while signed in marks it as read; it returns to the selected order, while later posts from that author remain eligible. Categories, search and popular discussions keep their own ordering.

Public user space profile cards show the user's current follower count, including for guests. Following or unfollowing refreshes the count.

While composing a post, select text and choose **内容锁定…** from the context menu. Choose one condition for each selection: reply, like or follow the author. Selections can span paragraphs. Select locked text again to change its condition or remove the lock. Drafts preserve the text and condition. Reply editors do not offer content locking.

The `posts.hide_content` permission controls this feature. Normal groups receive it by default; administrators can change it in group permissions. Both the editor and API check active group grants. Authors can read their own content. Other readers unlock a segment through an undeleted reply (including a nested reply), a current like or a current follow of the author. Removing the like, follow or last qualifying reply locks the relevant segment again. Guests must sign in. Click-to-reveal spoiler formatting remains a separate feature.

The API removes protected text, links and attributes from locked responses. Feed previews, search results, public spaces and folder lists always redact these segments; eligible readers open the post detail to read them. Migration `015_follows_and_content_locks.sql` creates follow relationships and grants hidden-content permission to existing normal and management groups. The API applies it automatically at startup.

## Favorites and public user spaces

Open **我的收藏** from the user dashboard to create, rename or delete folders, choose public visibility, move saved posts or remove favorites. Each user can have up to 100 folders with names of 1–64 characters.

Choose **设为默认** in the folder list, or enable the default option while creating or editing a folder. Each user can have one default folder; deleting it clears the selection. When a post is unsaved, the left side of its favorite split button saves to the default folder or opens the folder menu if no default is set. When saved, clicking the left side removes the post from all of your folders. The dropdown manages individual folders or creates a folder. The button uses the accent color when the post is in any folder and returns to its ordinary appearance when all saves are removed. Likes use a toggle button with an accent color while selected; the state persists after refresh.

Avatars on post lists, post bylines and replies open `/users/:uid`. Public spaces show published posts readable by the visitor and public folders. Hidden, deleted, pending and rejected posts are excluded from public spaces and public favorites. Private folders are owner-only. Public folder contents and counts respect the visitor's reader level.

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
- `posts.review` grants access to **发帖审核**, including reading the body, author, creation time, current groups and submission IP. Historical posts have no recorded submission IP. Reviewers can approve, reject with a reason, or reject and temporarily ban the author. Rejection and bans create private notifications. Temporarily banned accounts retain read-only access until expiry.

The built-in **站点管理** group starts with `posts.review` and `posts.bypass_review`. New management groups receive the management permissions selected for them. A user with only `posts.manage` cannot publish pending or rejected posts through the post-management API. Pending and rejected posts are visible to their author through their URL and to authorized reviewers in the review interface.

The group-permission migration removes management grants from existing ordinary/public groups, adds the three basic user permissions to management groups, and converts an existing management group with no management permission to a special group while preserving its memberships and capabilities. Removed grants and type conversions are recorded in the management audit log.

Administrators with `settings.manage` use **公告与通知** to send announcements to all current active accounts, an active group's members, or one UID. Recipients use **站内通知** to read announcements and review decisions, mark individual messages or all messages as read, and load older messages. The navigation badge refreshes every 30 seconds. New registrations do not receive earlier announcements.

## Uploads and emoji packs

In **图床与表情 → 上传与远端设置**, configure default storage and upload limits. Defaults are 1 GiB per user, 20 MiB per image, 20 personal emoji packs, 150 images per uploaded pack and 3 MiB per emoji image. Group settings can override individual limits; when several active groups specify a limit, the largest configured value applies. Unchecked overrides inherit the site default. The `media.use` permission controls personal image management and uploads; ordinary members receive it by default.

In **图床与表情 → 存储设置**, administrators can see used, remaining and total capacity for each backend and free space on every logical server disk. Configure the local maximum, the preferred local or S3-compatible object-storage backend, this site's object-storage quota and the amount released by each automatic cleanup batch (500 MiB by default). A local maximum of 0 follows the free space on the upload directory's disk; when the preferred backend cannot fit an upload, the other enabled backend is selected automatically.

Object-storage credentials are encrypted with `STORAGE_ENCRYPTION_KEY`, or `MAIL_ENCRYPTION_KEY` when the storage-specific key is not set. Each file records the configuration used for its upload, so changing or disabling the current endpoint does not break existing URLs. The quota is a site-local accounting limit and excludes unrelated objects in the same bucket. At 95% usage, active administrators with `media.manage` receive an in-site notification. If all enabled backends are full, the oldest ordinary images are reclaimed in batches and their post references are replaced with the deleted-image placeholder. Emoji packs, avatars and the site icon are never automatically reclaimed; failed S3 deletions remain queued for retry.

**我的图片** manages a user's uploads, personal emoji packs and downloaded remote packs. Private packs appear only in their owner's editor picker. Deleting an owned image replaces its existing post and reply references with the Akari placeholder at `apps/web/public/deleted-image.png`; other images and captions remain intact. This also applies when deleting an uploaded personal emoji pack. Active avatars and the site icon remain protected.

In **我的图片 → 我的表情包**, preview packs and use **上移 / 下移** to save their personal order. The editor picker uses PipsPager. For packs with more than 20 images, wheel scrolling moves within the pack first; continuing in the same direction beyond the top or bottom switches groups after a longer scroll. Momentum is suppressed after switching. Hovering or focusing an emoji shows its name.

Remote emoji are inserted at the caret, inline with text, at twice the current font size (about 30px in normal body text). Consecutive emoji support individual Backspace/Delete, undo and draft restoration. Uploaded emoji retain their 80px block display. Inline emoji count toward the separate fixed limit of 1000 emoji per body, and the server validates their cached image identity. Migration 014 identifies existing remote emoji blocks so the renderer can append them to the preceding paragraph; uploaded emoji retain their existing display.

Remote downloads are disabled initially. Enable them and configure the source page and compatible [Bmoji](https://github.com/SomeOvO/Bmoji) API endpoint. Search, previews and static/GIF imports are supported. Downloads are cached once per API source, pack and version and do not consume personal storage. Remote pack sizes are controlled by the source server and are exempt from the 150-image upload limit. **用户下载的远端表情包计入个人组数限额** starts enabled. Disable it to count only uploaded packs. Re-enabling it keeps existing packs; users over the limit must remove packs before adding more. Removing a collected pack preserves shared cached files and existing post images.

Administrators can select an existing shared pack in **图床与表情** or download one as the community pack in **上传与远端设置**. Only one community pack is active. It is pinned first, excluded from personal pack quotas, and cannot be reordered or removed by users. An unset or empty community pack is hidden. Users with `posts.create` or `replies.create` may use it in the corresponding editor without `media.use`. Migration preserves the first populated shared pack and leaves the initial empty placeholder hidden.

Image management searches filenames, descriptions and pack names, combines search with collection and pack filters, and defaults to 50 images per page. `GET /api/admin/media/search` accepts `q`, `collection`, `packId`, `page` and `pageSize`. The original media list endpoints retain their array response.

## About and open-source credits

Open **关于** from the bottom of the navigation pane, above **外观设置** or **管理后台**. The page introduces WinUI-BBS, displays version 0.2.2 and provides links to its open-source dependencies. It is available to visitors and signed-in users.

The project version comes from the root `package.json`. Site administrators can configure their own community name independently.

## Frontend

The application uses WinUIonWeb's `TitleBar` and responsive `NavigationView` as its shell. Its `Frame` runs entrance transitions between sections and a drill-in transition when opening posts. Forms, dialogs, menus, lists, the category tree and progress indicators use the library's controls and theme resources. Light and dark themes are available from the title bar.

The hash routes support direct links to posts, categories and each administration page. The admin navigation shows the sections granted by the current user's groups. Editor.js handles rich text, inline spoilers, uploaded images and separate emoji blocks.

Popular discussions show posts directly, without category cards or a publish button above the list. The community home and category pages retain their category and posting entry points.

Windows uses its system Segoe Fluent Icons. Other platforms load local Fluent UI System Icons before the page mounts, covering application and control icons without a font installation. New icons need paired mappings, checked by `npm run check`; see the [icon compatibility guide (Chinese)](icon-compatibility.md).

`npm run check` checks both workspaces; `npm run build` builds the API and frontend. Run `npm run format -w apps/web` to format the frontend. An isolated frontend test instance can point its Vite proxy at a separate API using `FORUM_API_URL`.

Run `npm run test:integration -w apps/api` to verify registration, invitations, media ownership and quotas, shared remote caching, category settings, timed bans, review permissions, notifications, deleted-image placeholders and recycle-bin isolation against PostgreSQL. The tests use the configured database, create temporary schemas and remove them after the run; the database role needs permission to create schemas.

WinUI-BBS and WinUIonWeb are GPL-3.0-only. Editor.js is Apache-2.0. License texts and third-party notices are collected in `LICENSE`, `THIRD_PARTY_NOTICES.md` and `licenses/`.
