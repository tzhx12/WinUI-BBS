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

export const permissionKeys = [
  ...managementPermissions,
  ...basicUserPermissions,
  'posts.set_reader_level',
  'posts.hide_content',
  'posts.bypass_review',
  'posts.require_review',
] as const

export function groupPermissionError(groupType: string, permissions: readonly string[]) {
  const hasManagementPermission = managementPermissions.some((key) => permissions.includes(key))
  if (['normal', 'public'].includes(groupType) && hasManagementPermission)
    return '普通用户组和公开用户组不能拥有管理类权限'
  if (groupType === 'management') {
    if (!hasManagementPermission) return '管理用户组至少需要一个管理类权限'
    if (basicUserPermissions.some((key) => !permissions.includes(key)))
      return '管理用户组必须保留发帖、回复和使用图床权限'
  }
  return null
}
