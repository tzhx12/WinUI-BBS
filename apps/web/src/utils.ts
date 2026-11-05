import { h, type Component } from 'vue'
import { DataTemplate } from 'winuionweb'

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})
export const formatDate = (value: string) => dateFormatter.format(new Date(value))

export const formatBytes = (bytes: number) =>
  bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(2)} GiB`
    : bytes >= 1024 ** 2
      ? `${(bytes / 1024 ** 2).toFixed(1)} MiB`
      : `${(bytes / 1024).toFixed(1)} KiB`

const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})
export const formatDateTime = (value: string) => dateTimeFormatter.format(new Date(value))

// WinUI's DataTemplate materializes this binding in each item's data context.
export function itemTemplate(component: Component, property = 'item', props: Record<string, unknown> = {}) {
  return h(DataTemplate, {}, { default: () => [h(component, { ...props, [property]: '{x:Bind}' })] })
}

export function categoryPath(category: { slug: string }) {
  return `/category/${encodeURIComponent(category.slug)}`
}

export function postPath(post: { id: string; category_slug: string; status?: string }) {
  return post.status === 'hidden'
    ? `/post/${post.id}`
    : `${categoryPath({ slug: post.category_slug })}/post/${post.id}`
}

export const groupTypes = [
  { value: 'global', label: '全局管理员用户组' },
  { value: 'management', label: '管理用户组' },
  { value: 'public', label: '公开用户组' },
  { value: 'normal', label: '普通用户组' },
  { value: 'temporary', label: '临时用户组' },
  { value: 'special', label: '特殊用户组' },
]

export const permissions = [
  ['users.manage', '管理用户'],
  ['groups.manage', '管理用户组'],
  ['levels.manage', '管理等级'],
  ['posts.manage', '发帖管理'],
  ['categories.manage', '管理板块'],
  ['media.manage', '管理图床与表情'],
  ['media.use', '使用图床'],
  ['settings.manage', '管理站点设置'],
  ['posts.create', '发帖'],
  ['posts.set_reader_level', '发帖阅读等级设置'],
  ['posts.hide_content.reply', '回复后解锁'],
  ['posts.hide_content.like', '点赞后解锁'],
  ['posts.hide_content.follow', '关注后解锁'],
  ['posts.bypass_review', '发帖全局免审核'],
  ['posts.require_review', '发帖必须审核'],
  ['posts.review', '发帖审核'],
  ['posts.review.ban', '封禁发帖账号'],
  ['replies.create', '回复帖子'],
] as const

export const managementPermissionKeys: readonly string[] = [
  'users.manage',
  'groups.manage',
  'levels.manage',
  'posts.manage',
  'posts.review',
  'posts.review.ban',
  'categories.manage',
  'media.manage',
  'settings.manage',
]
export const basicUserPermissionKeys: readonly string[] = ['posts.create', 'replies.create', 'media.use']
