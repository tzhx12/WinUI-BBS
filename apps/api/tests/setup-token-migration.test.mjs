import 'dotenv/config'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { Pool } from 'pg'

test('secure setup token migration works without public extensions in the search path', async () => {
  const schema = `forum_setup_token_${randomUUID().replaceAll('-', '')}`
  const control = new Pool({ connectionString: process.env.DATABASE_URL })
  await control.query(`CREATE SCHEMA ${schema}`)
  const connection = new URL(process.env.DATABASE_URL)
  connection.searchParams.set('options', `-c search_path=${schema},pg_catalog`)
  const isolated = new Pool({ connectionString: connection.toString() })
  try {
    await isolated.query('CREATE TABLE users (uid BIGINT PRIMARY KEY)')
    await isolated.query(await readFile(new URL('../migrations/022_secure_setup.sql', import.meta.url), 'utf8'))
    const result = await isolated.query('SELECT setup_token FROM installation_state')
    assert.match(result.rows[0].setup_token, /^[a-f0-9]{64}$/)
  } finally {
    await isolated.end()
    await control.query(`DROP SCHEMA ${schema} CASCADE`)
    await control.end()
  }
})
