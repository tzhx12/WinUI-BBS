import { parseFragment, serialize, type DefaultTreeAdapterTypes as Tree } from 'parse5'
import { query } from './db.js'
import { mediaError } from './media.js'

type Body = { blocks: Array<{ type: string; data: Record<string, unknown> }> }
type Condition = 'reply' | 'like' | 'follow'
const labels: Record<Condition, string> = {
  reply: '回复后解锁',
  like: '点赞后解锁',
  follow: '关注后解锁',
}

function mapStrings(value: unknown, transform: (text: string) => string): unknown {
  if (typeof value === 'string') return transform(value)
  if (Array.isArray(value)) return value.map((item) => mapStrings(item, transform))
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapStrings(item, transform)]))
  return value
}

function mapBodyHtml<T extends Body>(body: T, transform: (text: string) => string): T {
  return {
    ...body,
    blocks: body.blocks.map((block) =>
      ['paragraph', 'header', 'quote', 'list', 'image'].includes(block.type)
        ? { ...block, data: mapStrings(block.data, transform) as Record<string, unknown> }
        : block,
    ),
  }
}

function visit(node: Tree.Node, action: (element: Tree.Element) => boolean | void) {
  if ('tagName' in node && action(node) === false) return
  if ('childNodes' in node) node.childNodes.forEach((child) => visit(child, action))
}

export async function validateContentLocks(body: Body, uid: string, kind: 'post' | 'reply') {
  let count = 0
  mapBodyHtml(body, (text) => {
    if (!text.includes('<')) return text
    visit(parseFragment(text), (element) => {
      const lock = element.attrs.find((attr) => attr.name === 'data-content-lock')
      if (!lock) return
      if (
        element.tagName !== 'span' ||
        !Object.hasOwn(labels, lock.value) ||
        element.attrs.some((attr) => !['data-content-lock', 'class'].includes(attr.name))
      )
        throw mediaError('内容锁定格式无效，请重新选择文字')
      let nested = false
      element.childNodes.forEach((child) =>
        visit(child, (node) => {
          if (node.attrs.some((attr) => attr.name === 'data-content-lock')) nested = true
        }),
      )
      if (nested || !serialize(element).trim()) throw mediaError('锁定内容不能为空或互相嵌套')
      count++
    })
    return text
  })
  if (!count) return
  if (kind !== 'post') throw mediaError('仅帖子正文支持内容锁定')
  const permission = await query(
    `SELECT 1 FROM group_memberships gm JOIN group_permissions gp ON gp.group_id=gm.group_id
     WHERE gm.user_uid=$1 AND gp.permission_key='posts.hide_content'
       AND (gm.expires_at IS NULL OR gm.expires_at>NOW()) LIMIT 1`,
    [uid],
  )
  if (!permission.rowCount) throw mediaError('当前用户组没有隐藏段落权限', 403)
}

// Remove the protected subtree, including attributes, before content leaves the API.
export function visibleBody<T extends Body>(body: T, unlocked: Partial<Record<Condition, boolean>> = {}): T {
  return mapBodyHtml(body, (text) => {
    if (!text.includes('<')) return text
    const fragment = parseFragment(text)
    let changed = false
    visit(fragment, (element) => {
      const condition = element.attrs.find((attr) => attr.name === 'data-content-lock')?.value as
        Condition | undefined
      if (!condition) return
      changed = true
      if (unlocked[condition]) {
        element.attrs = []
        return
      }
      element.attrs = [
        { name: 'data-content-lock', value: condition },
        { name: 'data-lock-state', value: 'locked' },
        { name: 'class', value: 'forum-content-locked' },
      ]
      element.childNodes = [
        { nodeName: '#text', value: `[${labels[condition] || '内容已锁定'}]`, parentNode: element },
      ]
      return false
    })
    return changed ? serialize(fragment) : text
  })
}

export async function postUnlocks(postId: string, authorUid: string, uid: string | null) {
  if (!uid) return { reply: false, like: false, follow: false }
  return (
    await query<{ reply: boolean; like: boolean; follow: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM replies WHERE post_id=$1 AND author_uid=$2 AND deleted_at IS NULL) AS reply,
      EXISTS(SELECT 1 FROM post_likes WHERE post_id=$1 AND user_uid=$2) AS like,
      EXISTS(SELECT 1 FROM user_follows WHERE follower_uid=$2 AND followed_uid=$3) AS follow`,
      [postId, uid, authorUid],
    )
  ).rows[0]!
}
