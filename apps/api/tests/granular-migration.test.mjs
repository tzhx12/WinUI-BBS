import 'dotenv/config'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { test } from 'node:test'
import { Pool } from 'pg'

test('permission upgrade preserves existing group lock grants while making reviewer bans opt-in', async () => {
  const schema = `forum_granular_${randomUUID().replaceAll('-', '')}`
  const control = new Pool({ connectionString: process.env.DATABASE_URL })
  await control.query(`CREATE SCHEMA ${schema}`)
  const connection = new URL(process.env.DATABASE_URL)
  connection.searchParams.set('options', `-c search_path=${schema},public`)
  const isolated = new Pool({ connectionString: connection.toString() })
  try {
    const directory = new URL('../migrations/', import.meta.url)
    for (const file of (await readdir(directory))
      .filter((file) => file.endsWith('.sql') && file < '025')
      .sort()) {
      await isolated.query('BEGIN')
      await isolated.query(await readFile(new URL(file, directory), 'utf8'))
      await isolated.query('COMMIT')
    }
    const groups = await isolated.query(
      "INSERT INTO user_groups(name,group_type) VALUES('已有隐藏权限','special'),('明确无隐藏权限','normal'),('仅审核','special') RETURNING id,name",
    )
    const [withLocks, withoutLocks, reviewer] = groups.rows
    await isolated.query(
      "INSERT INTO group_permissions(group_id,permission_key) VALUES($1,'posts.hide_content'),($2,'posts.review')",
      [withLocks.id, reviewer.id],
    )
    await isolated.query('BEGIN')
    await isolated.query(await readFile(new URL('025_granular_content_permissions.sql', directory), 'utf8'))
    await isolated.query('COMMIT')
    const keys = async (id) =>
      (
        await isolated.query(
          'SELECT permission_key FROM group_permissions WHERE group_id=$1 ORDER BY permission_key',
          [id],
        )
      ).rows.map((row) => row.permission_key)
    assert.deepEqual(await keys(withLocks.id), [
      'posts.hide_content.follow',
      'posts.hide_content.like',
      'posts.hide_content.reply',
    ])
    assert.deepEqual(await keys(withoutLocks.id), [])
    assert.deepEqual(await keys(reviewer.id), ['posts.review'])
    assert.equal(
      (await isolated.query("SELECT 1 FROM group_permissions WHERE permission_key='posts.hide_content'"))
        .rowCount,
      0,
    )
    const global = (await isolated.query("SELECT id FROM user_groups WHERE group_type='global'")).rows[0]
    for (const key of [
      'posts.hide_content.reply',
      'posts.hide_content.like',
      'posts.hide_content.follow',
      'posts.review.ban',
    ])
      assert.ok((await keys(global.id)).includes(key))
  } finally {
    await isolated.query('ROLLBACK')
    await isolated.end()
    await control.query(`DROP SCHEMA ${schema} CASCADE`)
    await control.end()
  }
})
