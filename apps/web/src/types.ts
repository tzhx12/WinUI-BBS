export interface EditorData {
  time?: number
  version?: string
  blocks: Array<{ id?: string; type: string; data: Record<string, unknown> }>
}

export interface ReplyEntry {
  id: string
  body: EditorData
  author_uid: string | null
  display_name: string | null
  avatar_url: string | null
  created_at: string
  floor_number: number
  child_number: number | null
  parent_reply_id: string | null
  deleted_at: string | null
  deletion_source: 'author' | 'admin' | null
  reply_to_uid: string | null
  reply_to_name: string | null
}
export interface ChildReplyPage {
  replies: ReplyEntry[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}
export interface ReplyThread extends ReplyEntry {
  children: ChildReplyPage
}

export interface PageParameter {
  path: string
  id?: string
  query: Record<string, string | undefined>
}

export interface Category {
  id: string
  parent_id: string | null
  name: string
  slug: string
  description: string
  accent_color: string
  icon_glyph: string
  show_notification: boolean
  requires_review: boolean
  minimum_reader_level: number
  minimum_author_level: number
  sort_order: number
  post_count?: string | number
}

export interface User {
  uid: string
  uuid: string
  username: string
  usernameChangeAvailableAt?: string | null
  email?: string
  displayName: string
  experience: number
  level: number
  avatarUrl?: string | null
  groups?: Array<{ id: string; name: string; group_type: string; expires_at: string | null }>
  permissions?: string[]
  title?: { title: string; color: string } | null
  checkedIn?: boolean
  isBanned?: boolean
  bannedUntil?: string | null
  pointsPerLevel?: number
  checkinPoints?: number
}

export interface PostSummary {
  id: string
  title: string
  body: EditorData
  minimum_reader_level: number
  is_pinned: boolean
  view_count: number
  created_at: string
  category_id: string
  category_name: string
  category_color: string
  author_uid: string
  username: string
  display_name: string
  avatar_url: string | null
  experience: string
  level_offset: number
  reply_count: number
  like_count: number
  status?: 'published' | 'pending' | 'hidden' | 'rejected'
  review_reason?: string
  deleted_at?: string | null
  purge_after?: string | null
}

export interface SiteNotification {
  id: string
  title: string
  body: string
  kind: 'announcement' | 'review' | 'moderation'
  post_id: string | null
  created_at: string
  read_at: string | null
  sender_name: string | null
}

export interface MediaAsset {
  id: string
  storage_key: string
  original_name: string
  mime_type: string
  byte_size: number
  alt_text: string
  collection: 'library' | 'emoji' | 'site_icon'
  remote_cached: boolean
  emoji_pack_id: string | null
  pack_name?: string | null
  url: string
  created_at: string
}
