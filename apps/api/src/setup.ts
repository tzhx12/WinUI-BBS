import { query } from './db.js'

export async function setupState(token?: string) {
  const result = await query<{ required: boolean; allowed: boolean }>(
    `SELECT NOT EXISTS (SELECT 1 FROM users) AS required,
      COALESCE(setup_token = $1, FALSE) AS allowed FROM installation_state`,
    [token ?? null],
  )
  const state = result.rows[0]!
  return { required: state.required, allowed: state.required && state.allowed }
}

export async function setupPath() {
  const result = await query<{ setup_token: string }>(
    'SELECT setup_token FROM installation_state WHERE setup_token IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users)',
  )
  return result.rows[0] ? `/#/setup/${result.rows[0].setup_token}` : null
}
