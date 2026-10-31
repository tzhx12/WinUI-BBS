import 'dotenv/config'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { Pool } from 'pg'

test('upgrade preserves existing roles, grants the global role only to UID 1, and closes setup for installed sites', async () => {
  const schema = `forum_upgrade_${randomUUID().replaceAll('-', '')}`
  const control = new Pool({ connectionString: process.env.DATABASE_URL })
  await control.query(`CREATE SCHEMA ${schema}`)
  const connection = new URL(process.env.DATABASE_URL)
  connection.searchParams.set('options', `-c search_path=${schema},public`)
  process.env.DATABASE_URL = connection.toString()
  const { pool, query, runMigrations } = await import('../src/db.ts')
  try {
    await query('CREATE TABLE schema_migrations (filename TEXT PRIMARY KEY)')
    for (const filename of (await readdir('migrations')).filter(file => file.endsWith('.sql') && file < '021').sort()) {
      await query(await readFile(resolve('migrations', filename), 'utf8'))
      await query('INSERT INTO schema_migrations VALUES ($1)', [filename])
    }
    await query(`INSERT INTO users(username,email,password_hash,display_name) VALUES
      ('old_owner','old-owner@example.test','fixture','原管理员'),
      ('old_manager','old-manager@example.test','fixture','原管理成员')`)
    await query(`INSERT INTO group_memberships(user_uid,group_id)
      SELECT u.uid,g.id FROM users u CROSS JOIN user_groups g WHERE g.name='站点管理'`)
    await query("INSERT INTO user_groups(name,group_type) VALUES ('全局管理员','special')")
    await runMigrations()
    const globals = (await query("SELECT * FROM user_groups WHERE group_type='global'")).rows
    assert.equal(globals.length, 1)
    assert.notEqual(globals[0].name, '全局管理员')
    const members = (await query('SELECT user_uid,expires_at FROM group_memberships WHERE group_id=$1', [globals[0].id])).rows
    assert.deepEqual(members, [{ user_uid: '1', expires_at: null }])
    assert.equal((await query("SELECT COUNT(*)::int AS count FROM group_memberships gm JOIN user_groups g ON g.id=gm.group_id WHERE g.name='站点管理'")).rows[0].count, 2)
    assert.equal((await query("SELECT is_protected FROM user_groups WHERE name='站点管理'")).rows[0].is_protected, false)
    assert.equal((await query('SELECT setup_token FROM installation_state')).rows[0].setup_token, null)
    await runMigrations()
    assert.equal((await query("SELECT COUNT(*)::int AS count FROM user_groups WHERE group_type='global'")).rows[0].count, 1)
  } finally {
    await pool.end()
    await control.query(`DROP SCHEMA ${schema} CASCADE`)
    await control.end()
  }
})
