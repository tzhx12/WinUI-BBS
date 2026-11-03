# Secure deployment and vulnerability reports

[Configuration](configuration.en.md) · [简体中文](security.md)

## Put the production site behind an HTTPS reverse proxy

Serve the built frontend, not the Vite development server. Run the application as a dedicated unprivileged account. Restrict PostgreSQL to application and database-administrator access. Back up the database, all of `apps/api/data/`, object storage and the original encryption keys.

1. Generate a unique session secret:

   ```sh
   node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
   ```

2. Set `NODE_ENV=production`, the generated `JWT_SECRET`, `HOST=127.0.0.1` and the complete `FORUM_WEB_ROOT` in the service environment. The secret must contain at least 32 bytes and must not be an example value. The installer already generates a JWT secret; existing installations still need their listener and proxy configuration checked. Retain the original `MAIL_ENCRYPTION_KEY` / `STORAGE_ENCRYPTION_KEY` across upgrades; the former encrypts mail credentials, TOTP secrets and the Turnstile secret key.
3. For a proxy on the same host, set `FORUM_TRUST_PROXY=127.0.0.1,::1`. Otherwise specify the proxy's actual IPs/CIDRs and firewall the API against direct client access. Forwarded headers are untrusted by default; `true`, `*` and all-address CIDRs are rejected.
4. The HTTPS Nginx `server` can use this location. Configure the certificate and hostname separately, and redirect HTTP to HTTPS. Overwrite client-supplied forwarding headers:

   ```nginx
   client_max_body_size 110m;
   location / {
       proxy_pass http://127.0.0.1:4000;
       proxy_http_version 1.1;
       proxy_set_header Host $host;
       proxy_set_header X-Forwarded-For $remote_addr;
       proxy_set_header X-Forwarded-Proto $scheme;
   }
   ```

Open the site over HTTPS and check `/api/health`. Responses should include HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` and CSP. API responses use `Cache-Control: no-store`. The private setup URL in startup logs is a secret for the site owner.

## Authentication and content protections

Sensitive endpoints limit requests per client IP, aggregating IPv6 addresses by /64. Login allows 20/minute; registration and setup each allow 5/10 minutes; mail and reset endpoints each allow 10/10 minutes; password changes allow 5/minute. Each endpoint counts independently. Excess requests receive 429 and `Retry-After`. Existing per-email cooldowns, daily recovery limits and five-attempt verification codes remain active. When enabled, Turnstile challenges for sign-in, registration, registration-code requests, password recovery, password reset and password changes are verified server-side against Cloudflare Siteverify, including the expected action. Limits are local to one API process: multi-instance deployments need shared gateway limits, and public gateways should enforce request/connection quotas against distributed abuse.

New passwords bcrypt-hash the SHA-256 digest of the complete UTF-8 password and carry a `$forum-sha256$v1$` marker. This avoids bcrypt's 72-byte truncation. Legacy bcrypt passwords continue to work; users with old long passwords need to change them to enable full-byte verification. **Older programs cannot verify newly created or changed passwords.** Roll back only to a version supporting the marker, or restore the pre-upgrade database during a maintenance outage.

TOTP enrollment expires after ten minutes. Codes use 30-second periods with one period of clock tolerance in each direction, and successful counters are recorded to reject replay. After password verification, an opaque login challenge lasts five minutes, permits five attempts and is consumed on success; the database stores only its HMAC. A new password login replaces the account's previous pending challenge. Email password resets preserve the bound authenticator.

DOMPurify sanitizes displayed rich text. Character counting uses an inert template, and links opening a new window receive `noopener noreferrer`. The pinned WinUIonWeb `0.2.0-forum.4` removes dynamic JavaScript evaluation from XAML and treats Vue-bound strings as literal data. Arbitrary JavaScript bindings and handler argument expressions from the upstream Gallery are unsupported; existing static member bindings and internal handlers remain available. CSP permits same-origin scripts, required inline styles and existing remote images; Cloudflare's challenge script, connection and frame sources are allowed only for Turnstile. Other cross-origin connections, inline scripts, dynamic evaluation, plugins and framing remain blocked. External image hosts can still observe visitors' IP addresses; `Referrer-Policy: no-referrer` prevents disclosure of the site's referring URL.

Uploads accept PNG, JPEG, WebP and GIF and check file signatures as well as MIME declarations. Permissions and quotas are enforced by the API. Signature checks do not replace complete media decoding or malware scanning. Stable `/uploads/` URLs distribute public media; they are not private-attachment authorization.

Remote emoji responses are limited to 4 MiB of JSON, 1000 items and 100 MiB of images per pack. Cross-origin downloads and every redirect reject private, loopback, link-local and reserved addresses, pinning validated DNS results at connection time. The exact API origin explicitly configured by an administrator may use a private self-hosted service. Treat that configuration as a trust boundary.

## Keep dependencies and deployments current

Install from the lockfile with `npm ci`, then audit against the official advisory endpoint:

```sh
npm audit --registry=https://registry.npmjs.org
```

An unsupported audit endpoint on an npm mirror is not a clean audit. A root `overrides` entry currently supplies patched `glob` for `@fastify/static`. Keep traversal, compression-negotiation and caching tests when upgrading that plugin before removing the override. Do not automatically downgrade Fastify plugins with `npm audit fix --force`.

Report vulnerabilities privately to the maintainer with the affected version, minimal reproduction, required permissions and impact. Never attach real credentials, session tokens or user data to public issues, logs, screenshots or pull requests.
