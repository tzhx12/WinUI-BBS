import assert from 'node:assert/strict'

export async function seedAdminPostLists(f) {
  const registered = await f.request('POST', '/api/auth/register', {
    username: 'post_search_author',
    displayName: '检索专用作者',
    email: 'post-search@example.test',
    password: f.password,
  })
  assert.equal(registered.statusCode, 201, registered.body)
  const author = registered.json()
  const category = (await f.request('GET', '/api/categories')).json()[0]
  for (const kind of ['published', 'pending', 'rejected', 'deleted']) {
    await f.query(
      `INSERT INTO posts(category_id, author_uid, title, body, status, created_at, reviewed_at, deleted_at, deletion_source, deleted_by)
      SELECT $1,$2,$3 || ' ' || n,$4::jsonb,$5,'2026-01-01'::timestamptz,
      CASE WHEN $5 <> 'pending' THEN NOW() END,
      CASE WHEN $6 THEN NOW() END,CASE WHEN $6 THEN 'admin' ELSE 'author' END,CASE WHEN $6 THEN $7::bigint END
      FROM generate_series(1,79)n`,
      [
        category.id,
        author.user.uid,
        `检索验收 ${kind}`,
        JSON.stringify({
          blocks: [
            {
              type: 'paragraph',
              data: { text: '中文斜体 Italic text 与菜单验收。' },
            },
          ],
        }),
        kind === 'deleted' ? 'published' : kind,
        kind === 'deleted',
        f.owner.user.uid,
      ],
    )
  }
  await f.query(
    `INSERT INTO posts(category_id,author_uid,title,body,status)
    VALUES($1,$2,'100%字面量隐藏帖子','{"blocks":[]}'::jsonb,'hidden')`,
    [category.id, author.user.uid],
  )
  await f.query(
    `INSERT INTO posts(category_id,author_uid,title,body,deleted_at,deletion_source)
    VALUES($1,$2,'用户回收站隔离','{"blocks":[]}'::jsonb,NOW(),'author')`,
    [category.id, author.user.uid],
  )
  return { author, category }
}
