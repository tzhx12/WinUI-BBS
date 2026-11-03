# WinUI-BBS 0.5.0

0.5.0 正式版加入 TOTP 两步登录和 Cloudflare Turnstile 人机验证，并集中改进账号安全、论坛性能与权限管理。

## 账号安全

- 用户可在“用户后台 → 资料管理”扫描二维码绑定身份验证器；启用后登录需额外输入 TOTP 验证码。支持密码与验证码确认后关闭，验证码防重放，登录挑战限时、限次使用。
- 拥有 `settings.manage` 权限的管理员可在“注册管理”配置 Turnstile，保护登录、注册、找回密码、重设密码和更改密码。小组件统一居中，窄屏使用紧凑尺寸。
- 登录、注册、邮件、改密和首启接口增加限流；新密码保留完整 UTF-8 内容，修复 bcrypt 的 72 字节截断问题。
- 加固生产密钥检查、可信代理、响应缓存与 CSP；修复 WinUI XAML 动态脚本求值和正文计数时的 DOM 注入风险。
- 上传检查图片文件头；远端表情下载限制目标地址、重定向和资源容量，防止跨源请求访问私有网络。

## 性能与使用体验

- 路由与 WinUI 组件按需加载，生产资源提供 Brotli/gzip 和缓存策略。
- 首页、热门、板块、用户空间与后台列表改进分页；回复统计由数据库维护，楼中楼预览使用批量查询。
- 密码运算移至有界工作线程，图片流式暂存，远端表情下载与图库写入分离。
- 细分隐藏内容与审核封禁权限，改进账号状态筛选和封禁提示，增加帖子与回复图片预览。
- 固定 WinUIonWeb `0.2.0-forum.4`，修复按需导入控件的图标、提示与网格依赖。

## 升级到 0.5.0

1. 备份 PostgreSQL、完整 `apps/api/data/`、对象存储及原部署配置，保留原 `MAIL_ENCRYPTION_KEY` / `STORAGE_ENCRYPTION_KEY`。
2. 下载附件 `winui-bbs.tar.gz`。已有一键安装实例可从“站点设置 → 系统更新”升级；源码部署更新后执行 `npm ci`、`npm run check` 和 `npm run build`，再重启服务。
3. API 自动应用迁移 025–029。迁移 027 首次回填回复数并创建索引，会锁定相关表，大数据库请安排维护时段。部署前端时保留完整 `dist` 及 `.br` / `.gz` 文件。
4. TOTP 与 Turnstile 默认关闭。启用前确认加密密钥已配置；Turnstile 使用站点自己的公钥、私钥和 Cloudflare 域名配置。身份验证器账号应备份，邮箱重置密码不会移除 TOTP。

程序回退需使用支持当前密码格式和 TOTP 的版本，或在停机后配套恢复升级前数据库。旧程序无法验证新密码格式，也不会执行 TOTP 验证。

完整配置见[使用与配置](https://github.com/tzhx12/WinUI-BBS/blob/v0.5.0/docs/configuration.md)、[安全部署](https://github.com/tzhx12/WinUI-BBS/blob/v0.5.0/docs/security.md)和[安装、更新与恢复](https://github.com/tzhx12/WinUI-BBS/blob/v0.5.0/docs/releases.md)。
