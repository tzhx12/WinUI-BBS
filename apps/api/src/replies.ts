import type { FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { QueryResultRow } from 'pg'
import { query } from './db.js'
import { contentLimits } from './settings.js'
import { mediaError } from './media.js'

export const pageSchema = z.object({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
})
export const replyColumns = `r.id,r.body,r.created_at,r.author_uid,r.floor_number,r.child_number,r.parent_reply_id,r.deleted_at,r.deletion_source,
 u.username,u.display_name,u.avatar_url,t.author_uid AS reply_to_uid,tu.display_name AS reply_to_name`
export const replyJoins = `LEFT JOIN users u ON u.uid=r.author_uid LEFT JOIN replies t ON t.id=r.reply_to_id AND t.deleted_at IS NULL LEFT JOIN users tu ON tu.uid=t.author_uid`

export async function childReplyPage(rootId: string, page = 1) {
  const count = await query<{ count: number }>(
    'SELECT COUNT(*)::int AS count FROM replies WHERE parent_reply_id=$1 AND deleted_at IS NULL',
    [rootId],
  )
  const total = count.rows[0]!.count
  const totalPages = Math.max(1, Math.ceil(total / 5))
  page = Math.min(page, totalPages)
  const replies = await query(
    `SELECT ${replyColumns} FROM replies r ${replyJoins} WHERE r.parent_reply_id=$1 AND r.deleted_at IS NULL ORDER BY r.child_number LIMIT 5 OFFSET $2`,
    [rootId, (page - 1) * 5],
  )
  return { replies: replies.rows, page, pageSize: 5, total, totalPages }
}

export async function replyPage(request: FastifyRequest, postId: string) {
  const parsed = pageSchema
    .extend({ reply: z.uuid().optional() })
    .safeParse(request.query)
  if (!parsed.success) throw mediaError('回复页码无效')
  const pageSize = (await contentLimits()).repliesPerPage
  const counts = await query<{ threads: number; total: number }>(
    `SELECT
    COUNT(*) FILTER(WHERE parent_reply_id IS NULL AND (deleted_at IS NULL OR EXISTS(SELECT 1 FROM replies c WHERE c.parent_reply_id=replies.id)))::int AS threads,
    COUNT(*) FILTER(WHERE deleted_at IS NULL)::int AS total FROM replies WHERE post_id=$1`,
    [postId],
  )
  const totalThreadCount = counts.rows[0]!.threads
  const totalPages = Math.max(1, Math.ceil(totalThreadCount / pageSize))
  let requestedPage = parsed.data.page
  if (parsed.data.reply) {
    const target = await query<{ floor_number: number }>(
      `SELECT root.floor_number FROM replies target JOIN replies root ON root.id=COALESCE(target.parent_reply_id,target.id)
       WHERE target.id=$1 AND target.post_id=$2`,
      [parsed.data.reply, postId],
    )
    if (target.rows[0]) {
      const before = await query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM replies r
         WHERE r.post_id=$1 AND r.parent_reply_id IS NULL AND r.floor_number<$2
           AND (r.deleted_at IS NULL OR EXISTS(SELECT 1 FROM replies c WHERE c.parent_reply_id=r.id))`,
        [postId, target.rows[0].floor_number],
      )
      requestedPage = Math.floor(before.rows[0]!.count / pageSize) + 1
    }
  }
  const page = Math.min(requestedPage, totalPages)
  const roots = await query(
    `SELECT ${replyColumns} FROM replies r ${replyJoins}
    WHERE r.post_id=$1 AND r.parent_reply_id IS NULL AND (r.deleted_at IS NULL OR EXISTS(SELECT 1 FROM replies c WHERE c.parent_reply_id=r.id))
    ORDER BY r.floor_number LIMIT $2 OFFSET $3`,
    [postId, pageSize, (page - 1) * pageSize],
  )
  const ids = roots.rows.map((root) => root.id)
  const [childCounts, previews] = ids.length
    ? await Promise.all([
        query<{ parent_reply_id: string; total: number }>(
          `SELECT parent_reply_id,COUNT(*)::int AS total FROM replies
           WHERE parent_reply_id=ANY($1::uuid[]) AND deleted_at IS NULL GROUP BY parent_reply_id`,
          [ids],
        ),
        query(
          `SELECT ${replyColumns} FROM unnest($1::uuid[]) roots(id)
           CROSS JOIN LATERAL (
             SELECT * FROM replies WHERE parent_reply_id=roots.id AND deleted_at IS NULL
             ORDER BY child_number LIMIT 5
           ) r ${replyJoins} ORDER BY r.parent_reply_id,r.child_number`,
          [ids],
        ),
      ])
    : [{ rows: [] }, { rows: [] }]
  const totals = new Map(
    childCounts.rows.map((row) => [row.parent_reply_id, row.total]),
  )
  const children = new Map<string, QueryResultRow[]>()
  for (const child of previews.rows) {
    const rows = children.get(child.parent_reply_id) ?? []
    rows.push(child)
    children.set(child.parent_reply_id, rows)
  }
  const replies = roots.rows.map((root) => {
    const total = totals.get(root.id) ?? 0
    return {
      ...root,
      children: {
        replies: children.get(root.id) ?? [],
        page: 1,
        pageSize: 5,
        total,
        totalPages: Math.max(1, Math.ceil(total / 5)),
      },
    }
  })
  return {
    replies,
    page,
    pageSize,
    totalPages,
    totalReplyCount: counts.rows[0]!.total,
    totalThreadCount,
  }
}
