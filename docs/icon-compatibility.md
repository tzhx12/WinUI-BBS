# 跨系统图标

Windows 访问者继续使用本机的 Segoe Fluent Icons；macOS、Linux、Android 和 iOS
访问者加载网站自带的 Fluent UI System Icons。判断顺序为浏览器 Client Hints 的
`platform`、`navigator.platform`、User-Agent。未识别的系统使用 Fluent 分支。

`apps/web/src/iconPlatform.ts` 在 Vue 挂载前完成加载，使用 WinUIonWeb 的
`loadWinUIIconFont` 注册接口。Fluent 字体保留原有 Segoe 字符码，并注册到控件使用的
字体家族名，因此以下入口采用同一套对应关系：

- `IconGlyph` 和 `WinButton`。
- 前台和后台 NavigationView、首页板块卡片、板块树及图标选择器。
- WinUI 内置的下拉箭头、复选标记、文本框清除按钮、密码显示按钮和提示图标。

`iconCompatibility.css` 将非 Windows 的 InfoBar 从 Segoe 双色叠层改为 Fluent
单层图形，并沿用控件的主题语义色。

板块的 `icon_glyph` / `iconGlyph` 仍保存原有 Segoe 字符，无需数据库迁移。
映射覆盖项目现有图标、16 个板块选项和 WinUIonWeb 0.1.0 的内置字面量图标。
通过 API 设置其他自定义字符码时，需要先补充对应映射。

## 新增图标时同时补齐两套系统

例如，为新操作添加一个 Segoe 字符码：

1. 在 `apps/web/icons/fluent-system-icons.json` 的 `glyphs` 中，添加小写十六进制
   Segoe 字符码与 Fluent SVG 文件名的对应项（不含 `.svg`），例如
   `"e710": "add_24_regular"`。按功能语义和实际图形选择对应项，同一字符码只能对应一个图形。
2. 在现有 `IconGlyph.vue` / `iconNames.ts` 添加业务名称，或在导航、板块选项中使用该字符。
   同一个字符被不同业务名称复用时，两套系统都共享同一个图形。
3. 重新生成字体，并提交 JSON、生成的 WOFF 和调用方：

   ```powershell
   # 仅首次准备图标生成环境需要安装；普通构建直接使用仓库中的 WOFF。
   python -m pip install fonttools==4.58.1
   npm run build:icons -w apps/web
   npm run check
   npm run build
   ```

4. 在 Windows 分支和非 Windows 分支查看实际页面，确认尺寸、颜色、对齐与交互状态。
   浏览器模拟平台可检查分流和字体加载；真实设备验收用于检查目标系统上的最终显示。

`npm run check` 会检查源代码和 WinUIonWeb 内置字面量字符是否缺少对应项、SVG 是否存在，
并验证交付 WOFF 的字符映射。缺少配对或忘记重新生成字体时检查失败。
新增 `SymbolIcon` 枚举值时，应把其实际 Segoe 字符码加入对应表并检查渲染；升级
WinUIonWeb 或 Fluent SVG 包时也需运行上述流程。

## 资源与许可

- SVG 源：固定版本的开发依赖 `@fluentui/svg-icons` 1.1.344。
- 对应表：`apps/web/icons/fluent-system-icons.json`。
- 生成器：`apps/web/scripts/build-icon-font.py`。
- 交付字体：`apps/web/src/assets/fluent-system-icons.woff`，由 Vite 输出带版本指纹的本地资源。
- MIT 许可：`licenses/fluent-system-icons-MIT.txt`；致谢见 `THIRD_PARTY_NOTICES.md` 和关于页。

生成字体的轮廓全部来自 Fluent UI System Icons SVG；项目只引用 Windows 上的 Segoe
系统字体名称，不包含或分发 Segoe 字体文件。
