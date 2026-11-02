import { inTransaction } from './db.js'
import { visibleBody } from './lockedContent.js'

export const postFeedColumns = `p.id, p.title, p.body, p.minimum_reader_level, p.is_pinned, p.view_count, p.created_at,
  c.id AS category_id, c.slug AS category_slug, c.name AS category_name, c.accent_color AS category_color,
  u.uid AS author_uid, u.username, u.display_name, u.avatar_url, u.experience, u.level_offset,
  p.reply_count,
  (SELECT COUNT(*) FROM post_likes l WHERE l.post_id = p.id)::int AS like_count`

type SearchPost = {
  id: string
  title: string
  body: Parameters<typeof visibleBody>[0]
  is_pinned: boolean
  reply_count: number
  search_cursor_created_at: string
}

export async function searchPosts(
  readerLevel: number,
  category: string | undefined,
  keyword: string,
  sort: 'latest' | 'popular',
) {
  const limit = 60
  const needle = keyword.toLocaleLowerCase()
  const posts: Omit<SearchPost, 'search_cursor_created_at'>[] = []
  const replies = 'p.reply_count'
  const keys = `p.is_pinned, ${sort === 'popular' ? `${replies}, ` : ''}p.created_at, p.id`
  const order = `p.is_pinned DESC, ${sort === 'popular' ? `${replies} DESC, ` : ''}p.created_at DESC, p.id DESC`
  let cursor: SearchPost | undefined

  return inTransaction(async (client) => {
    // All batches must see the same ordering while posts and reply counts change.
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
    while (posts.length < limit) {
      const values: unknown[] = [readerLevel, category ?? null, keyword]
      let after = ''
      if (cursor) {
        values.push(cursor.is_pinned)
        if (sort === 'popular') values.push(cursor.reply_count)
        // Preserve PostgreSQL's timestamp precision when seeking past a batch.
        values.push(cursor.search_cursor_created_at, cursor.id)
        after = `AND (${keys}) < ($4::boolean, ${sort === 'popular' ? '$5::bigint, ' : ''}$${values.length - 1}::timestamptz, $${values.length}::uuid)`
      }
      const result = await client.query<SearchPost>(
        `SELECT ${postFeedColumns}, p.created_at::text AS search_cursor_created_at
       FROM posts p JOIN categories c ON c.id = p.category_id JOIN users u ON u.uid = p.author_uid
       WHERE p.status = 'published' AND p.deleted_at IS NULL AND p.minimum_reader_level <= $1
         AND c.minimum_reader_level <= $1
         AND ($2::bigint IS NULL OR c.id = $2)
         AND (p.title ILIKE '%' || $3 || '%' OR p.body::text ILIKE '%' || $3 || '%')
         ${after}
       ORDER BY ${order} LIMIT ${limit}`,
        values,
      )
      for (const row of result.rows) {
        const { search_cursor_created_at: _cursor, ...post } = row
        post.body = visibleBody(post.body)
        if (`${post.title} ${JSON.stringify(post.body)}`.toLocaleLowerCase().includes(needle)) {
          posts.push(post)
          if (posts.length === limit) break
        }
      }
      if (result.rows.length < limit) break
      cursor = result.rows.at(-1)
    }
    return posts
  })
}
