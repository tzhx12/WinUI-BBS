# Third-Party Notices

WinUI-BBS 0.3.0 is distributed under GPL-3.0-only. WinUIonWeb is also GPL-3.0-only; its full license is in `LICENSE` and its upstream-specific notices are in `licenses/WinUIonWeb-THIRD_PARTY_NOTICES.md`.

Editor.js is Apache-2.0. The license text is in `licenses/editorjs/Apache-2.0.txt`. The Editor.js tool packages used by the editor identify their licenses in their npm package metadata; the MIT-licensed tool packages remain separate dependencies in `package-lock.json`.

The frontend includes Vue and Vue Router under MIT (`licenses/vue-MIT.txt` and `licenses/vue-router-MIT.txt`), and DOMPurify under MPL-2.0 or Apache-2.0 (`licenses/dompurify/`). WinUIonWeb also lists its MathLive and rtf.js runtime dependencies and their notices in its upstream notice file.

Segoe Fluent Icons is referenced by local system font family name only. No Microsoft font file is included or redistributed.

On non-Windows systems, the frontend loads a local compatibility font derived from
[Microsoft Fluent UI System Icons](https://github.com/microsoft/fluentui-system-icons)
under MIT. The outlines come from `@fluentui/svg-icons` 1.1.344; the font remaps
selected SVGs to the Segoe codepoints used by the application and WinUIonWeb.
The license is in `licenses/fluent-system-icons-MIT.txt`, and the source mapping
and generator are in `apps/web/icons/fluent-system-icons.json` and
`apps/web/scripts/build-icon-font.py`.

## Project links

The application has an About page with links to these projects and their roles:

| Project                                                                                  | Role                                    | License                             |
| ---------------------------------------------------------------------------------------- | --------------------------------------- | ----------------------------------- |
| [WinUIonWeb](https://github.com/Furry-Xiyi/WinUIonWeb)                                   | WinUI components and themes             | GPL-3.0-only                        |
| [Fluent UI System Icons](https://github.com/microsoft/fluentui-system-icons)             | Icons on non-Windows systems             | MIT                                |
| [Vue](https://vuejs.org/) / [Vue Router](https://router.vuejs.org/)                      | UI runtime and routing                  | MIT                                 |
| [Editor.js](https://github.com/codex-team/editor.js)                                     | Block editor and tools                  | Apache-2.0; tool-package terms vary |
| [DOMPurify](https://github.com/cure53/DOMPurify)                                         | Rich-text sanitization                  | MPL-2.0 OR Apache-2.0               |
| [MathLive](https://cortexjs.io/mathlive/) / [rtf.js](https://github.com/tbluemel/rtf.js) | WinUIonWeb rich text support            | MIT                                 |
| [Node.js](https://nodejs.org/)                                                           | Server runtime                          | MIT and bundled component notices   |
| [Fastify](https://fastify.dev/)                                                          | API and server plugins                  | MIT                                 |
| [PostgreSQL](https://www.postgresql.org/)                                                | Database                                | PostgreSQL License                  |
| [node-postgres](https://github.com/brianc/node-postgres)                                 | Database driver                         | MIT                                 |
| [Zod](https://zod.dev/)                                                                  | Request validation                      | MIT                                 |
| [bcrypt.js](https://github.com/dcodeIO/bcrypt.js)                                        | Password hashing                        | BSD-3-Clause                        |
| [dotenv](https://github.com/motdotla/dotenv)                                             | Environment configuration               | BSD-2-Clause                        |
| [Vite](https://vite.dev/)                                                                | Frontend development and builds         | MIT                                 |
| [TypeScript](https://www.typescriptlang.org/)                                            | Type checking                           | Apache-2.0                          |
| [tsx](https://tsx.hirok.io/)                                                             | Development and integration-test runner | MIT                                 |
| [concurrently](https://github.com/open-cli-tools/concurrently)                           | Development process management          | MIT                                 |
| [Prettier](https://prettier.io/)                                                         | Formatting                              | MIT                                 |

[node-semver](https://github.com/npm/node-semver), licensed under ISC, implements SemVer parsing and ordering for builds and updates. Its installed package includes the license text.

Dependency versions are recorded in `package-lock.json`. Package-specific license files and notices remain with the installed dependencies.

[parse5](https://github.com/inikulin/parse5), licensed under MIT, parses rich-text fragments on the server to validate inline remote emoji and count them toward image limits. Its installed dependency includes the license text.

## Email libraries

[entities](https://github.com/fb55/entities) decodes HTML entities when counting visible body characters. It is licensed under BSD-2-Clause.

[Nodemailer](https://nodemailer.com/) provides SMTP message delivery under MIT-0. [ImapFlow](https://imapflow.com/) provides IMAP connections under MIT. The development-only [MailParser](https://nodemailer.com/extras/mailparser/) dependency is used to inspect acceptance-test mail under MIT. Each installed package includes its own license.

## Bmoji

[SomeOvO/Bmoji](https://github.com/SomeOvO/Bmoji) provides the remote emoji browser and compatible API referenced by the remote emoji integration. Its project homepage is <https://bmoji.3mua.cn/>.
