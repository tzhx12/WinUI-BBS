import type { PoolClient } from 'pg'

export async function sendReviewNotification(
  client: PoolClient,
  recipientUid: string,
  senderUid: string,
  postId: string,
  title: string,
  body: string,
) {
  const created = await client.query<{ id: string }>(
    `INSERT INTO notifications (title, body, kind, sender_uid, post_id)
     VALUES ($1, $2, 'review', $3, $4) RETURNING id`,
    [title, body, senderUid, postId],
  )
  await client.query(
    'INSERT INTO notification_recipients (notification_id, user_uid) VALUES ($1, $2)',
    [created.rows[0]!.id, recipientUid],
  )
}

export async function sendReplyNotification(
  client: PoolClient,
  recipientUid: string,
  senderUid: string,
  postId: string,
  replyId: string,
  body: string,
) {
  if (recipientUid === senderUid) return
  const blocked = await client.query(
    'SELECT 1 FROM notification_blocks WHERE user_uid=$1 AND blocked_uid=$2',
    [recipientUid, senderUid],
  )
  if (blocked.rowCount) return
  const created = await client.query<{ id: string }>(
    `INSERT INTO notifications (title, body, kind, sender_uid, post_id, reply_id)
     VALUES ('回复了你', $1, 'reply', $2, $3, $4) RETURNING id`,
    [body, senderUid, postId, replyId],
  )
  await client.query(
    'INSERT INTO notification_recipients (notification_id, user_uid) VALUES ($1, $2)',
    [created.rows[0]!.id, recipientUid],
  )
}
