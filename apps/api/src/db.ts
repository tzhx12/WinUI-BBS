import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Pool, type PoolClient, type QueryResultRow } from 'pg'

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 12,
  idleTimeoutMillis: 30_000,
})

export function query<T extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []) {
  return pool.query<T>(text, values)
}

export async function inTransaction<T>(work: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function runMigrations() {
  const directory = resolve(process.cwd(), 'migrations')
  const files = (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort()
  await query('CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY)')
  for (const file of files) {
    await inTransaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('forum-migrations'))")
      const applied = await client.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [file])
      if (applied.rowCount) return
      await client.query(await readFile(resolve(directory, file), 'utf8'))
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file])
    })
  }
}

export async function effectiveLevel(experience: number | string, offset: number) {
  const setting = await query<{ setting_value: number }>(
    "SELECT setting_value::text::integer AS setting_value FROM app_settings WHERE setting_key = 'points_per_level'",
  )
  const pointsPerLevel = Math.max(1, setting.rows[0]?.setting_value ?? 100)
  return Math.max(1, Math.floor(Number(experience) / pointsPerLevel) + 1 + offset)
}

export async function awardExperience(uid: string, actionKey: string, client?: PoolClient) {
  const db = client ?? pool
  const rule = await db.query<{ points: number; is_enabled: boolean }>(
    'SELECT points, is_enabled FROM experience_rules WHERE action_key = $1',
    [actionKey],
  )
  if (!rule.rows[0]?.is_enabled || !rule.rows[0].points) return null

  const updated = await db.query<{ experience: string; level_offset: number }>(
    'UPDATE users SET experience = experience + $2 WHERE uid = $1 RETURNING experience, level_offset',
    [uid, rule.rows[0].points],
  )
  if (!updated.rows[0]) return null
  const level = await effectiveLevel(updated.rows[0].experience, updated.rows[0].level_offset)
  return { points: rule.rows[0].points, experience: Number(updated.rows[0].experience), level }
}
