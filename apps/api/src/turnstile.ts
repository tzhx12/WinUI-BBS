import type { FastifyRequest } from 'fastify'
import type { Pool, PoolClient } from 'pg'
import { z } from 'zod'
import { decryptSecret } from './accountSecrets.js'
import { pool } from './db.js'

export const turnstileConfigSchema = z.object({
  enabled: z.boolean(),
  siteKey: z.string().trim().max(512),
  secretKey: z.string().max(2000),
})

export type TurnstileConfig = z.infer<typeof turnstileConfigSchema>

const verificationError = (message: string, statusCode: number) =>
  Object.assign(new Error(message), { statusCode })

export async function readTurnstileConfig(db: Pool | PoolClient = pool, lock = false) {
  const result = await db.query<{ setting_value: unknown }>(
    `SELECT setting_value FROM app_settings WHERE setting_key='turnstile_config'${lock ? ' FOR UPDATE' : ''}`,
  )
  const parsed = turnstileConfigSchema.safeParse(result.rows[0]?.setting_value)
  if (!parsed.success) throw verificationError('人机验证配置无效，请联系站点管理员', 503)
  return parsed.data
}

export function adminTurnstileConfig(config: TurnstileConfig) {
  return { enabled: config.enabled, siteKey: config.siteKey, hasSecret: !!config.secretKey }
}

export async function verifyTurnstile(request: FastifyRequest, token: string | undefined, action: string) {
  const config = await readTurnstileConfig()
  if (!config.enabled) return
  if (!token || token.length > 2048) throw verificationError('请完成人机验证后重试', 400)
  if (!config.siteKey || !config.secretKey)
    throw verificationError('人机验证设置不完整，请联系站点管理员', 503)

  const body = new URLSearchParams({
    secret: decryptSecret(config.secretKey),
    response: token,
    remoteip: request.ip,
  })
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) throw verificationError('人机验证服务暂不可用，请稍后重试', 503)
    const result = z
      .object({ success: z.boolean(), action: z.string().optional() })
      .passthrough()
      .safeParse(await response.json())
    if (!result.success || !result.data.success || result.data.action !== action)
      throw verificationError('人机验证已失效，请重新验证', 400)
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode) throw error
    request.log.warn({ err: error }, 'Turnstile verification request failed')
    throw verificationError('人机验证服务暂不可用，请稍后重试', 503)
  }
}
