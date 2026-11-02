# WinUIonWeb 0.2.0 (forum.3)

The web workspace installs `winuionweb-0.2.0-forum.3.tgz` from this directory.
The archive is included in Git and release packages, so `npm ci` needs neither
a local checkout nor an unpublished npm version.

Upstream: https://github.com/Furry-Xiyi/WinUIonWeb

Source commit: `692d0a76dad3fa92515bc50db44ed626d83b695e` (upstream 0.2.0).

`native-contextmenu.patch` leaves browser context menus available on ordinary
links, inputs and editable content. A custom menu still cancels its own event;
only a handled touch long-press suppresses the subsequent click. This avoids
changing the forum's existing editor menu and native copy/paste behavior.

`treeview-touch-scroll.patch` forwards a vertical single-finger gesture to the
existing scrollable-ancestor helper while retaining pointer capture. The upstream
`touch-action: none` otherwise prevents the intended native scroll after cancelling
the pending drag. Long-press drag, horizontal drag and secondary-touch scrolling
keep their upstream implementation.

`named-xaml-exports.patch` exposes DataTemplate and menu item components as named
exports. The forum can import its controls directly without registering the entire
library, which would include unused rich text, math and media controls in the entry bundle.
`preserve-modules.patch` keeps component module boundaries in the published JavaScript
so the application build can remove unused controls and their initialization code.

`local-component-dependencies.patch` imports the internal icon, tooltip and grid
definition components needed by named control imports. CheckBox, ComboBox and
ExpanderBase use local animated visual sources; TitleBar imports ToolTip; SplitButton
and DropDownButton import ColumnDefinition. This removes development resolution
warnings and restores separate primary and dropdown click areas in SplitButton
without global registration. `npm run check:components -w apps/web` renders these
named exports without the global plugin to catch missing internal dependencies.

Rebuild from the pinned upstream source with Node >=22.12.0, npm, Git and tar:

```powershell
node scripts/build-winuionweb.mjs
```

An optional absolute checkout path can be passed to reuse existing Git objects.
The script archives the fixed commit, not the checkout's working files, installs
the upstream locked toolchain, applies the patch, builds and packs the library.
Builds include matching library source, build configuration, `build-package-lock.json`
and upstream license/notices. Gallery assets and Microsoft font files are excluded.
To rebuild an unpacked archive, restore the included lock before building:

```powershell
Copy-Item build-package-lock.json package-lock.json
npm ci
npm run build:lib
```

License: GPL-3.0-only; see the archive's LICENSE and THIRD_PARTY_NOTICES.md.
