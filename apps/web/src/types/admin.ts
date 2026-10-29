export interface Overview {
  stats: { users: string; posts: string; replies: string; checkins: string; pending: string; media: string }
  activity: Array<{ day: string; posts: number }>
  groups: Array<{ id: string; name: string; group_type: string; member_count: number }>
}
export interface AdminUser {
  uid: string
  uuid: string
  username: string
  email: string
  display_name: string
  experience: string
  level: number
  status: 'active' | 'suspended'
  banned_until: string | null
  is_banned: boolean
  created_at: string
  groups: string[]
}
export interface Group {
  media_limits: Partial<MediaLimits>
  id: string
  name: string
  group_type: string
  description: string
  is_joinable: boolean
  is_default: boolean
  is_protected: boolean
  permissions: string[]
  member_count: number
}
export interface GroupMember {
  uid: string
  username: string
  display_name: string
  expires_at: string | null
  joined_at: string
}
export interface LevelTitle {
  id?: string
  minimum_level: number
  maximum_level: number
  title: string
  color: string
}
export interface LevelConfig {
  pointsPerLevel: number
  titles: LevelTitle[]
  rules: Array<{
    action_key: 'checkin' | 'create_post' | 'create_reply'
    points: number
    is_enabled: boolean
  }>
}
export interface AdminPost {
  id: string
  title: string
  status: 'published' | 'pending' | 'hidden' | 'rejected'
  is_pinned: boolean
  minimum_reader_level: number
  created_at: string
  category_name: string
  author_uid: string
  display_name: string
  reply_count: number
}
export interface EmojiPack {
  is_community: boolean
  preview_urls: string[] | null
  created_by: string | null
  remote_source: string | null
  variant: 'static' | 'animated' | null
  id: string
  name: string
  sort_order: number
  emoji_count: number
}
export interface MediaLimits {
  storageBytes: number
  imageBytes: number
  emojiPackCount: number
  emojiImagesPerPack: number
  emojiImageBytes: number
}
export interface RemoteEmojiSettings {
  enabled: boolean
  countTowardPackLimit: boolean
  sourceUrl: string
  apiUrl: string
}
export interface MediaSettings {
  media_limits: MediaLimits
  remote_emoji: RemoteEmojiSettings
}
export interface Invitation {
  id: string
  code: string
  created_by: string
  owner_name?: string
  max_uses: number
  used_count: number
  is_enabled: boolean
  expires_at: string | null
  created_at: string
}
export interface InvitationRule {
  id: string
  minimum_level: number
  quantity: number
  is_enabled: boolean
}
export interface AuditEvent {
  id: string
  action_key: string
  target_type: string
  target_id: string | null
  details: unknown
  created_at: string
  actor_name: string | null
}

export interface ReviewPost {
  id: string
  title: string
  body?: import('../types').EditorData
  status: 'pending' | 'published' | 'rejected'
  created_at: string
  author_ip: string | null
  author_uid: string
  username: string
  display_name: string
  category_name: string
  groups: string[]
  review_reason: string
  reviewed_at?: string | null
  reviewer_name?: string | null
}

export interface DeletedPost extends AdminPost {
  deleted_at: string
  deleted_by_name: string | null
}

export interface Announcement {
  id: string
  title: string
  body: string
  created_at: string
  sender_name: string | null
  recipient_count: number
  read_count: number
  audience: { type: 'all' | 'group' | 'user'; id?: string }
}
