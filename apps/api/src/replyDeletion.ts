import type { PoolClient } from 'pg'
import { replyExcerpt } from './content.js'
import { mediaError } from './media.js'

export async function deleteReply(
  client: PoolClient,
  postId: string,
  replyId: string,
  actorUid: string,
  manager: boolean,
  scope: 'reply' | 'thread' = 'reply',
) {
  const post = (
    await client.query('SELECT title FROM posts WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [postId])
  ).rows[0]
  if (!post) throw mediaError('帖子不存在', 404)
  const entry = (
    await client.query('SELECT * FROM replies WHERE id=$1 AND post_id=$2 FOR UPDATE', [replyId, postId])
  ).rows[0]
  if (!entry) throw mediaError('回复不存在或已删除', 404)
  if (entry.deleted_at && !(manager && scope === 'thread')) throw mediaError('回复已删除', 404)
  if (entry.parent_reply_id && scope === 'thread') throw mediaError('楼中楼只能删除当前回复', 400)
  if (!manager && entry.author_uid !== actorUid) throw mediaError('只能删除自己的回复', 403)
  const children = entry.parent_reply_id
    ? 0
    : (
        await client.query<{ count: number }>(
          'SELECT COUNT(*)::int AS count FROM replies WHERE parent_reply_id=$1',
          [entry.id],
        )
      ).rows[0]!.count
  const removed = (
    await client.query(
      `SELECT id,author_uid,floor_number,child_number,body FROM replies WHERE deleted_at IS NULL AND (id=$1 OR ($2 AND parent_reply_id=$1)) ORDER BY floor_number,child_number NULLS FIRST`,
      [entry.id, scope === 'thread'],
    )
  ).rows
  if (children && scope === 'reply')
    await client.query(
      'UPDATE replies SET body=\'{"blocks":[]}\'::jsonb,author_uid=NULL,reply_to_id=NULL,deleted_at=NOW(),deletion_source=$2 WHERE id=$1',
      [entry.id, manager ? 'admin' : 'author'],
    )
  else await client.query('DELETE FROM replies WHERE id=$1', [entry.id])
  if (entry.parent_reply_id)
    await client.query(
      'DELETE FROM replies r WHERE r.id=$1 AND r.deleted_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM replies c WHERE c.parent_reply_id=r.id)',
      [entry.parent_reply_id],
    )
  if (manager) {
    const floor = (row: (typeof removed)[number]) =>
      `第${row.floor_number}楼${row.child_number ? `-${row.child_number}层` : ''}`
    for (const author of new Set(removed.map((row) => row.author_uid))) {
      if (!author || author === actorUid) continue
      const replies = removed.filter((row) => row.author_uid === author)
      const floors = replies.map(floor).join('、')
      const excerpts = replies.map((row) => `${floor(row)}：${replyExcerpt(row.body)}`).join('\n')
      const notice = await client.query<{ id: string }>(
        `INSERT INTO notifications(title,body,kind,sender_uid,post_id) VALUES('回复已被管理员删除',$1,'moderation',$2,$3) RETURNING id`,
        [
          `你在《${post.title}》中的${floors}回复已被管理员删除，无法恢复。\n删除内容摘要：\n${excerpts}`,
          actorUid,
          postId,
        ],
      )
      await client.query('INSERT INTO notification_recipients(notification_id,user_uid) VALUES($1,$2)', [
        notice.rows[0]!.id,
        author,
      ])
    }
    await client.query(
      `INSERT INTO audit_events(actor_uid,action_key,target_type,target_id,details) VALUES($1,$2,'reply',$3,$4::jsonb)`,
      [
        actorUid,
        scope === 'thread' ? 'reply.delete.cascade' : 'reply.delete',
        entry.id,
        JSON.stringify({
          title: post.title,
          postId: postId,
          scope: scope,
          removed: removed.map((row) => ({
            excerpt: replyExcerpt(row.body, 240),
            id: row.id,
            authorUid: row.author_uid,
            floor: row.floor_number,
            childFloor: row.child_number,
          })),
        }),
      ],
    )
  }
  return {
    deleted: true,
    retainedChildren: children > 0 && scope === 'reply',
    removedCount: removed.length,
  }
}
