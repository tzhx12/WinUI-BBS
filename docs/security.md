# 安全部署与漏洞报告

[使用与配置](configuration.md) · [English](security.en.md)

## 将站点放到 HTTPS 反向代理后

生产环境使用构建后的站点，不将 Vite 开发服务器暴露到公网。以独立的非特权账号运行应用，PostgreSQL 仅允许应用和数据库管理员连接。保留数据库、完整 `apps/api/data/`、对象存储和原加密密钥的备份。

1. 为部署生成独立 JWT 密钥：

   ```sh
   node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
   ```

2. 在服务环境中配置 `NODE_ENV=production`、生成的 `JWT_SECRET`、`HOST=127.0.0.1` 和完整 `FORUM_WEB_ROOT`。密钥至少 32 字节，不可使用示例值。安装脚本已生成 JWT 密钥；已有安装仍需检查监听地址和代理设置。邮件凭据、TOTP 密钥及 Turnstile 私钥使用 `MAIL_ENCRYPTION_KEY` 加密，对象存储凭据使用 `STORAGE_ENCRYPTION_KEY`；不要随更新更换这些密钥。
3. 反代与 API 在同一主机时设置 `FORUM_TRUST_PROXY=127.0.0.1,::1`。远端代理填写实际代理 IP/CIDR，并用防火墙阻止其他客户端直连 API。默认不信任转发头；`true`、`*` 和全网段配置会被拒绝。
4. Nginx 的 HTTPS `server` 中可使用以下代理段。证书和域名由部署环境配置；HTTP 入口应重定向到 HTTPS。代理覆盖转发头，不采用客户端自报的地址：

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

通过 HTTPS 打开站点并检查 `/api/health`。确认响应含 `Strict-Transport-Security`、`X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY` 和 CSP，API 含 `Cache-Control: no-store`。启动日志中的首启入口是秘密，只提供给站点所有者。

## 认证和内容保护

敏感接口按客户端 IP 限流，IPv6 按 /64 聚合。登录为 20 次/分钟，注册及首启分别为 5 次/10 分钟，发信与重置相关接口分别为 10 次/10 分钟，修改密码为 5 次/分钟；超出返回 429 和 `Retry-After`。每个接口单独计数，按邮箱的间隔、每日找回次数和验证码 5 次尝试限制另行生效。启用 Turnstile 后，登录、注册、注册验证码发送、找回密码、重设密码及改密相关接口还会在服务端向 Cloudflare Siteverify 校验一次性令牌和 action。当前限流存储在单个 API 进程内；多实例部署在统一网关增加共享限流，公网同时配置请求/连接配额以应对分布式滥用。

新密码使用完整 UTF-8 内容的 SHA-256 结果进行 bcrypt 加盐散列，保存时带 `$forum-sha256$v1$` 标记，避免 bcrypt 截断 72 字节之后的内容。原 bcrypt 密码保持可登录；旧长密码需要用户修改后才获得完整字节校验。**回退到不支持该格式的旧程序会导致新建或已改密账号无法登录。** 回退时使用仍支持新格式的版本，或在维护停机期间配套恢复升级前数据库。

TOTP 绑定请求有效期为 10 分钟。验证码采用 30 秒周期，允许前后一个周期的时钟偏差；成功使用后记录计数，防止重放。密码验证后签发的随机登录挑战有效 5 分钟，最多尝试 5 次，成功后立即消费；数据库只保存挑战的 HMAC。新登录挑战会替换该用户之前尚未完成的挑战。邮箱重置密码不会移除已绑定的验证器。

正文富文本经过 DOMPurify 净化；正文计数使用惰性模板，外链新窗口加入 `noopener noreferrer`。固定的 WinUIonWeb `0.2.0-forum.4` 移除 XAML 动态脚本求值，Vue 动态字符串作为字面值显示；不再支持上游 Gallery 的任意 JavaScript 绑定及事件参数表达式。现有控件的静态成员绑定和内部处理器保持可用。CSP 允许站点脚本、必要的内联样式和现有外链图片；仅为 Turnstile 加入 Cloudflare 验证所需脚本、连接和 frame，其他跨源连接仍被阻止。内联脚本、动态求值、插件和嵌入本站均被禁止。外链图片仍可能向图片提供者暴露访问者 IP；`Referrer-Policy: no-referrer` 阻止发送本站来源地址。

上传只允许 PNG、JPEG、WebP、GIF，除 MIME 类型外还检查文件头；容量和权限在 API 执行。文件头检查不能替代完整媒体解码或恶意内容扫描。上传文件是公开资源：稳定 `/uploads/` 地址用于公开分发，不作为私密附件访问控制。

远端表情按每份 JSON 4 MiB、每包 1000 条目和 100 MiB 图片限制资源。跨源图片下载及每次重定向阻止私有、回环、链路本地与保留地址，并在连接时固定已校验的 DNS 地址。管理员配置的 API 同源允许私网自托管服务；该配置是信任边界，勿将不可信服务设为 API 源。

## 保持依赖和部署可更新

使用锁文件安装 `npm ci`，并用官方安全公告接口审计：

```sh
npm audit --registry=https://registry.npmjs.org
```

部分 npm 镜像不提供审计服务，接口失败不等于没有漏洞。当前 `@fastify/static` 的 `glob` 通过根目录 `overrides` 使用修复版本；升级静态服务时保留路径穿越、压缩协商与缓存测试，再判断是否可删除覆盖。不要使用 `npm audit fix --force` 自动降级 Fastify 插件。

发现漏洞时，先向维护者私下提供受影响版本、最小复现、需要的权限和影响；不要在公开 issue、日志、截图或 PR 中附带真实密钥、会话令牌或用户数据。
