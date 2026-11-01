export const managementPermissions = [
  'users.manage',
  'groups.manage',
  'levels.manage',
  'posts.manage',
  'posts.review',
  'categories.manage',
  'media.manage',
  'settings.manage',
] as const

export const basicUserPermissions = ['posts.create', 'replies.create', 'media.use'] as const
export const contentLockPermissions = [
  'posts.hide_content.reply',
  'posts.hide_content.like',
  'posts.hide_content.follow',
] as const

export const permissionKeys = [
  ...managementPermissions,
  'posts.review.ban',
  ...basicUserPermissions,
  'posts.set_reader_level',
  ...contentLockPermissions,
  'posts.bypass_review',
  'posts.require_review',
] as const

// Older group API callers grant all three conditions with the original key.
export function expandLegacyPermissions(permissions: readonly string[]) {
  return [
    ...new Set(
      permissions.flatMap((key) => (key === 'posts.hide_content' ? [...contentLockPermissions] : [key])),
    ),
  ]
}

export function groupPermissionError(groupType: string, permissions: readonly string[]) {
  const hasManagementPermission = [...managementPermissions, 'posts.review.ban'].some((key) =>
    permissions.includes(key),
  )
  if (permissions.includes('posts.review.ban') && !permissions.includes('posts.review'))
    return '审核封禁权限需要同时拥有发帖审核权限'
  if (['normal', 'public'].includes(groupType) && hasManagementPermission)
    return '普通用户组和公开用户组不能拥有管理类权限'
  if (groupType === 'management') {
    if (!hasManagementPermission) return '管理用户组至少需要一个管理类权限'
    if (basicUserPermissions.some((key) => !permissions.includes(key)))
      return '管理用户组必须保留发帖、回复和使用图床权限'
  }
  return null
}
