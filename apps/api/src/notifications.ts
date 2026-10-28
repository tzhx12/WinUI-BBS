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
  await client.query('INSERT INTO notification_recipients (notification_id, user_uid) VALUES ($1, $2)', [
    created.rows[0]!.id,
    recipientUid,
  ])
}
