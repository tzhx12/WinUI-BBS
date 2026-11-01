import { z } from 'zod'
import { query } from './db.js'

export const adminPostListQuery = z.object({
  q: z.string().trim().max(200).default(''),
  page: z.coerce.number().int().min(1).max(2147483647).optional(),
})

// Search user identifiers exactly; names and titles accept literal substrings.
export const adminPostSearch = `($1 = '' OR strpos(lower(p.title), lower($1)) > 0
  OR u.uid::text = $1 OR lower(u.uuid::text) = lower($1)
  OR strpos(lower(u.display_name), lower($1)) > 0 OR strpos(lower(u.username), lower($1)) > 0)`

export async function adminPostList(
  select: string,
  from: string,
  order: string,
  values: unknown[],
  requestedPage?: number,
) {
  // Existing callers without page retain their array response and limit.
  if (requestedPage === undefined)
    return (await query(`${select} ${from} ORDER BY ${order} LIMIT 200`, values)).rows

  const pageSize = 25
  const count = await query<{ total: number }>(`SELECT COUNT(*)::int AS total ${from}`, values)
  const total = count.rows[0]!.total
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(requestedPage, totalPages)
  const posts = (
    await query(
      `${select} ${from} ORDER BY ${order} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, pageSize, (page - 1) * pageSize],
    )
  ).rows
  return { posts, page, pageSize, total, totalPages }
}
