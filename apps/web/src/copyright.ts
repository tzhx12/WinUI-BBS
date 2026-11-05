import cc0Badge from './assets/copyright/cc-zero.svg'
import byBadge from './assets/copyright/by.svg'
import bySaBadge from './assets/copyright/by-sa.svg'
import byNcBadge from './assets/copyright/by-nc.svg'
import byNcSaBadge from './assets/copyright/by-nc-sa.svg'
import byNdBadge from './assets/copyright/by-nd.svg'
import byNcNdBadge from './assets/copyright/by-nc-nd.svg'

export const copyrightLicenses = [
  {
    value: 'cc0',
    label: 'CC0',
    name: 'CC0 1.0 公共领域贡献',
    url: 'https://creativecommons.org/publicdomain/zero/1.0/deed.zh-hans',
    badge: cc0Badge,
    notice: '在法律允许的范围内放弃版权及相关权利，可自由转载、改编及商业使用。',
  },
  {
    value: 'cc-by-4.0',
    label: 'CC BY 4.0',
    name: '知识共享 署名 4.0 国际',
    url: 'https://creativecommons.org/licenses/by/4.0/deed.zh-hans',
    badge: byBadge,
    notice: '可转载、改编及商业使用；须署名、提供原文与许可链接，并注明修改。',
  },
  {
    value: 'cc-by-sa-4.0',
    label: 'CC BY-SA 4.0',
    name: '知识共享 署名-相同方式共享 4.0 国际',
    url: 'https://creativecommons.org/licenses/by-sa/4.0/deed.zh-hans',
    badge: bySaBadge,
    notice: '可转载、改编及商业使用；须署名、提供原文与许可链接、注明修改，改编作品须以相同协议发布。',
  },
  {
    value: 'cc-by-nc-4.0',
    label: 'CC BY-NC 4.0',
    name: '知识共享 署名-非商业性使用 4.0 国际',
    url: 'https://creativecommons.org/licenses/by-nc/4.0/deed.zh-hans',
    badge: byNcBadge,
    notice: '仅限非商业转载及改编；须署名、提供原文与许可链接，并注明修改。',
  },
  {
    value: 'cc-by-nc-sa-4.0',
    label: 'CC BY-NC-SA 4.0',
    name: '知识共享 署名-非商业性使用-相同方式共享 4.0 国际',
    url: 'https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans',
    badge: byNcSaBadge,
    notice: '仅限非商业转载及改编；须署名、提供原文与许可链接、注明修改，改编作品须以相同协议发布。',
  },
  {
    value: 'cc-by-nd-4.0',
    label: 'CC BY-ND 4.0',
    name: '知识共享 署名-禁止演绎 4.0 国际',
    url: 'https://creativecommons.org/licenses/by-nd/4.0/deed.zh-hans',
    badge: byNdBadge,
    notice: '可转载及商业使用；须署名、提供原文与许可链接，不得传播改编作品。',
  },
  {
    value: 'cc-by-nc-nd-4.0',
    label: 'CC BY-NC-ND 4.0',
    name: '知识共享 署名-非商业性使用-禁止演绎 4.0 国际',
    url: 'https://creativecommons.org/licenses/by-nc-nd/4.0/deed.zh-hans',
    badge: byNcNdBadge,
    notice: '仅限非商业转载；须署名、提供原文与许可链接，不得传播改编作品。',
  },
] as const

export type CopyrightLicense = (typeof copyrightLicenses)[number]['value'] | 'none' | 'all-rights-reserved'

export const copyrightOptions = [
  { value: 'none', label: '不适用' },
  ...copyrightLicenses.map(({ value, label }) => ({ value, label })),
  { value: 'all-rights-reserved', label: '版权所有声明' },
]
