import { inject, reactive, ref, watch, type InjectionKey } from 'vue'
import { api, ApiError } from './api'
import type { Category, User } from './types'
import { projectInfo } from './projectInfo'

export const adminSections = [
  { id: 'overview', label: '管理概览', icon: '\ue9d2', permission: 'users.manage' },
  { id: 'users', label: '用户', icon: '\ue716', permission: 'users.manage' },
  { id: 'invitations', label: '邀请码', icon: '\ue8a7', permission: 'users.manage' },
  { id: 'registration', label: '注册管理', icon: '\ue8d4', permission: 'settings.manage' },
  { id: 'groups', label: '用户组与权限', icon: '\ue72e', permission: 'groups.manage' },
  { id: 'levels', label: '等级与经验', icon: '\ue734', permission: 'levels.manage' },
  { id: 'categories', label: '板块结构', icon: '\ue8b7', permission: 'categories.manage' },
  { id: 'posts', label: '发帖管理', icon: '\ue8bd', permission: 'posts.manage' },
  { id: 'deleted-posts', label: '删除记录', icon: '\ue74d', permission: 'posts.manage' },
  { id: 'reviews', label: '发帖审核', icon: '\ue73e', permission: 'posts.review' },
  { id: 'review-settings', label: '审核设置', icon: '\ue72e', permission: 'settings.manage' },
  { id: 'content-settings', label: '发帖与回复设置', icon: '\ue8bd', permission: 'settings.manage' },
  { id: 'notifications', label: '公告与通知', icon: '\ue715', permission: 'settings.manage' },
  { id: 'media', label: '图床与表情', icon: '\ue8b9', permission: 'media.manage' },
  { id: 'settings', label: '站点设置', icon: '\ue713', permission: 'settings.manage' },
  { id: 'mail', label: '发信设置', icon: '\ue715', permission: 'settings.manage' },
  { id: 'appearance', label: '外观设置', icon: '\ue771', permission: 'settings.manage' },
  { id: 'audit', label: '管理记录', icon: '\ue823', permission: 'settings.manage' },
] as const

export const adminNavigationGroups = [
  {
    id: 'members',
    label: '用户与注册',
    icon: '\ue716',
    sections: ['users', 'groups', 'levels', 'invitations', 'registration'],
  },
  {
    id: 'content',
    label: '内容管理',
    icon: '\ue8bd',
    sections: [
      'categories',
      'posts',
      'reviews',
      'deleted-posts',
      'review-settings',
      'content-settings',
      'media',
      'notifications',
    ],
  },
  {
    id: 'configuration',
    label: '站点配置',
    icon: '\ue713',
    sections: ['settings', 'mail', 'appearance', 'audit'],
  },
]

export function createSite() {
  const token = ref<string | null>(localStorage.getItem('forum-token'))
  const user = ref<User | null>(null)
  const categories = ref<Category[]>([])
  const settings = reactive({
    title: projectInfo.name,
    icon: '',
    url: '',
    registrationEnabled: true,
    registrationMode: 'open' as 'open' | 'invite',
    postsRequireReview: false,
    contentLimits: {
      postCharacters: 20000,
      postImages: 15,
      replyCharacters: 1000,
      replyImages: 5,
      repliesPerPage: 20,
      directLibraryUploads: false,
    },
    emailSecurity: {
      registrationVerification: false,
      codeMinutes: 60,
      resendSeconds: 60,
      recoveryEnabled: true,
      resetMinutes: 30,
      recoveryDailyLimit: 1,
      passwordChangeSeconds: 60,
    },
  })
  const theme = ref<'light' | 'dark'>((localStorage.getItem('forum-theme') as 'light' | 'dark') || 'light')
  const compactNavigation = ref(localStorage.getItem('forum-compact-navigation') === 'true')
  const fontScale = ref(Number(localStorage.getItem('forum-font-scale') || 100))
  const accent = ref(localStorage.getItem('forum-accent') || 'blue')
  const authOpen = ref(false)
  const unreadCount = ref(0)
  const notification = ref('')
  const confirmation = reactive({ open: false, title: '', message: '', action: '确认' })
  watch(
    theme,
    (value) => {
      const root = document.documentElement
      root.classList.toggle('theme-dark', value === 'dark')
      root.classList.toggle('theme-light', value === 'light')
      root.dataset.theme = value
      root.style.colorScheme = value
    },
    { immediate: true, flush: 'sync' },
  )
  let resolveConfirmation: ((accepted: boolean) => void) | undefined
  let notificationTimer: ReturnType<typeof setTimeout>

  function loadAppearance() {
    theme.value = (localStorage.getItem('forum-theme') as 'light' | 'dark') || 'light'
    compactNavigation.value = localStorage.getItem('forum-compact-navigation') === 'true'
    fontScale.value = Number(localStorage.getItem('forum-font-scale') || 100)
    accent.value = localStorage.getItem('forum-accent') || 'blue'
    document.documentElement.style.setProperty('--forum-font-scale', String(fontScale.value / 100))
    document.documentElement.dataset.accent = accent.value
  }

  function notify(message: string) {
    notification.value = message
    clearTimeout(notificationTimer)
    notificationTimer = setTimeout(() => {
      notification.value = ''
    }, 4000)
  }

  function updateSettings(value: {
    title?: string
    icon?: string
    url?: string
    registrationEnabled?: boolean
    registrationMode?: 'open' | 'invite'
    postsRequireReview?: boolean
    emailSecurity?: typeof settings.emailSecurity
    contentLimits?: typeof settings.contentLimits
  }) {
    Object.assign(settings, value)
    document.title = `${settings.title} · 社区`
    document.querySelector<HTMLLinkElement>('link[rel="icon"]')!.href = settings.icon || '/brand-mark.png'
  }

  async function loadCategories() {
    categories.value = await api<Category[]>('/api/categories', { token: token.value })
  }

  async function refreshUnread() {
    if (!token.value || !user.value) {
      unreadCount.value = 0
      return
    }
    try {
      const result = await api<{ count: number }>('/api/me/notifications/unread', { token: token.value })
      unreadCount.value = result.count
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error
      unreadCount.value = 0
    }
  }

  async function refreshUser() {
    if (!token.value) {
      user.value = null
      return
    }
    try {
      user.value = await api<User>('/api/auth/me', { token: token.value })
      await refreshUnread()
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error
      signOut(false)
    }
  }

  async function load() {
    const [value] = await Promise.all([
      api<{
        site_title: string
        site_icon_url: string
        site_url: string
        registration_enabled: boolean
        registration_mode: 'open' | 'invite'
        posts_require_review: boolean
        email_security: typeof settings.emailSecurity
        content_limits: typeof settings.contentLimits
      }>('/api/site'),
      loadCategories(),
      refreshUser(),
    ])
    updateSettings({
      title: value.site_title,
      icon: value.site_icon_url,
      url: value.site_url,
      registrationEnabled: value.registration_enabled,
      registrationMode: value.registration_mode,
      postsRequireReview: value.posts_require_review,
      emailSecurity: value.email_security,
      contentLimits: value.content_limits,
    })
    loadAppearance()
  }

  async function authenticate(value: { token: string; user: User }) {
    token.value = value.token
    localStorage.setItem('forum-token', value.token)
    user.value = value.user
    authOpen.value = false
    await refreshUser()
  }

  function signOut(showMessage = true) {
    token.value = null
    user.value = null
    unreadCount.value = 0
    localStorage.removeItem('forum-token')
    if (showMessage) notify('已退出登录')
  }

  function toggleTheme() {
    theme.value = theme.value === 'light' ? 'dark' : 'light'
    localStorage.setItem('forum-theme', theme.value)
  }

  function confirm(title: string, message: string, action = '确认') {
    Object.assign(confirmation, { open: true, title, message, action })
    return new Promise<boolean>((resolve) => {
      resolveConfirmation = resolve
    })
  }

  function finishConfirmation(accepted: boolean) {
    confirmation.open = false
    resolveConfirmation?.(accepted)
    resolveConfirmation = undefined
  }

  return {
    token,
    user,
    categories,
    settings,
    theme,
    compactNavigation,
    fontScale,
    accent,
    authOpen,
    unreadCount,
    refreshUnread,
    notification,
    confirmation,
    notify,
    load,
    authenticate,
    refreshUser,
    loadCategories,
    signOut,
    updateSettings,
    toggleTheme,
    confirm,
    finishConfirmation,
    loadAppearance,
  }
}

export type Site = ReturnType<typeof createSite>
export const siteKey: InjectionKey<Site> = Symbol('forum-site')
export function useSite() {
  return inject(siteKey)!
}
