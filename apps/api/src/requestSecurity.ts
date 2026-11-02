import { randomUUID } from 'node:crypto'
import { isIP } from 'node:net'
import type { FastifyInstance } from 'fastify'
import rateLimit from '@fastify/rate-limit'

export function sessionSecret(env: NodeJS.ProcessEnv = process.env) {
  const secret = env.JWT_SECRET
  if (secret !== undefined) {
    if (Buffer.byteLength(secret) < 32 || /^(replace[-_]with|change[-_]me)/i.test(secret))
      throw new Error('JWT_SECRET must be a private random value of at least 32 bytes')
    return secret
  }
  if (env.NODE_ENV === 'production' || env.FORUM_WEB_ROOT)
    throw new Error('JWT_SECRET is required for production')
  return randomUUID()
}

export function trustedProxies(value = process.env.FORUM_TRUST_PROXY): false | string[] {
  if (!value?.trim()) return false
  const addresses = value.split(',').map((part) => part.trim())
  for (const address of addresses) {
    const [ip, prefix, extra] = address.split('/')
    const family = isIP(ip!)
    if (!family || extra !== undefined || (prefix !== undefined &&
      (!/^\d+$/.test(prefix) || Number(prefix) < 1 || Number(prefix) > (family === 4 ? 32 : 128))))
      throw new Error('FORUM_TRUST_PROXY must contain explicit proxy IP addresses or CIDRs')
  }
  return addresses
}

export const authRateLimits = {
  login: { max: 20, timeWindow: '1 minute' },
  register: { max: 5, timeWindow: '10 minutes' },
  setup: { max: 5, timeWindow: '10 minutes' },
  email: { max: 10, timeWindow: '10 minutes', groupId: 'auth-email' },
  reset: { max: 10, timeWindow: '10 minutes', groupId: 'password-reset' },
  change: { max: 5, timeWindow: '1 minute' },
}

export async function registerRequestSecurity(app: FastifyInstance) {
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_request, context) => ({
      statusCode: 429,
      error: `请求过于频繁，请在 ${Math.ceil(context.ttl / 1000)} 秒后重试`,
    }),
  })
  app.addHook('onRequest', async (request, reply) => {
    reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('X-Frame-Options', 'DENY')
      .header('Referrer-Policy', 'no-referrer')
      .header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
      .header('Content-Security-Policy', [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: http: https:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "worker-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ].join('; '))
    if (request.url.split('?')[0]!.startsWith('/api/')) reply.header('Cache-Control', 'no-store')
    if (request.protocol === 'https') reply.header('Strict-Transport-Security', 'max-age=31536000')
  })
  app.setErrorHandler((error, request, reply) => {
    const statusCode = (error as { statusCode?: number }).statusCode
    const status = typeof statusCode === 'number' && statusCode >= 400 ? statusCode : 500
    if (status === 500) {
      request.log.error(error, 'Request failed')
      return reply.code(500).send({ error: '服务暂时不可用，请稍后重试' })
    }
    return reply.code(status).send(error)
  })
}
