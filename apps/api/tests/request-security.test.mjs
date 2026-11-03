import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { test } from 'node:test'
import Fastify from 'fastify'
import { authRateLimits, registerRequestSecurity, sessionSecret, trustedProxies } from '../src/requestSecurity.ts'

test('production refuses missing or example session secrets before startup', () => {
  for (const env of [{ NODE_ENV: 'production' }, { FORUM_WEB_ROOT: '/web' },
    { JWT_SECRET: '' }, { JWT_SECRET: 'short' }, { JWT_SECRET: 'replace-with-a-long-random-secret' }])
    assert.throws(() => sessionSecret(env), /JWT_SECRET/)
  const secret = randomBytes(48).toString('base64url')
  assert.equal(sessionSecret({ NODE_ENV: 'production', JWT_SECRET: secret }), secret)
  assert.ok(sessionSecret({}).length >= 32)
})

test('proxy trust accepts only explicit IP addresses and limited CIDRs', () => {
  assert.equal(trustedProxies(''), false)
  assert.deepEqual(trustedProxies('127.0.0.1,::1,10.1.0.0/16'), ['127.0.0.1', '::1', '10.1.0.0/16'])
  for (const value of ['true', '*', '0.0.0.0/0', '::/0', '1', 'localhost', '10.0.0.1/33', '::1/129', '127.0.0.1,'])
    assert.throws(() => trustedProxies(value), /FORUM_TRUST_PROXY/)
})

test('sensitive routes reject excess requests before parsing and ignore spoofed forwarded IPs', async () => {
  const app = Fastify()
  await registerRequestSecurity(app)
  for (const [name, limit] of Object.entries(authRateLimits))
    app.post('/api/' + name, { config: { rateLimit: limit } }, async () => ({ ok: true }))
  app.get('/api/health', async () => ({ ok: true }))
  try {
    for (const [name, limit] of Object.entries(authRateLimits)) {
      const remoteAddress = `198.51.100.${Object.keys(authRateLimits).indexOf(name) + 1}`
      for (let i = 0; i < limit.max; i++)
        assert.equal((await app.inject({ method: 'POST', url: '/api/' + name, remoteAddress })).statusCode, 200)
      const blocked = await app.inject({ method: 'POST', url: '/api/' + name, remoteAddress,
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.20' }, payload: '{' })
      assert.equal(blocked.statusCode, 429, blocked.body)
      assert.ok(Number(blocked.headers['retry-after']) > 0)
      assert.match(blocked.json().error, /请求过于频繁/)
      assert.equal((await app.inject({ method: 'POST', url: '/api/' + name, remoteAddress: '203.0.113.100' })).statusCode, 200)
    }
    assert.equal((await app.inject({ url: '/api/health' })).statusCode, 200)
  } finally { await app.close() }
})

test('trusted reverse proxy separates clients and supplies HTTPS security headers', async () => {
  const app = Fastify({ trustProxy: trustedProxies('127.0.0.1') })
  await registerRequestSecurity(app)
  app.post('/api/login', { config: { rateLimit: { max: 1, timeWindow: 60000 } } }, async () => ({}))
  app.get('/api/error', async () => { throw new Error('database password or SQL internals') })
  try {
    const headers = { 'x-forwarded-for': '203.0.113.1', 'x-forwarded-proto': 'https' }
    const request = { method: 'POST', url: '/api/login', remoteAddress: '127.0.0.1', headers }
    const ok = await app.inject(request)
    assert.equal(ok.statusCode, 200)
    assert.equal(ok.headers['cache-control'], 'no-store')
    assert.equal(ok.headers['strict-transport-security'], 'max-age=31536000')
    assert.equal(ok.headers['x-content-type-options'], 'nosniff')
    assert.equal(ok.headers['x-frame-options'], 'DENY')
    assert.equal(ok.headers['referrer-policy'], 'no-referrer')
    assert.match(ok.headers['content-security-policy'], /script-src 'self'/)
    assert.match(ok.headers['content-security-policy'], /challenges\.cloudflare\.com/)
    assert.match(ok.headers['content-security-policy'], /frame-src https:\/\/challenges\.cloudflare\.com/)
    assert.match(ok.headers['content-security-policy'], /frame-ancestors 'none'/)
    assert.equal((await app.inject(request)).statusCode, 429)
    assert.equal((await app.inject({ ...request, headers: { ...headers, 'x-forwarded-for': '203.0.113.2' } })).statusCode, 200)
    const error = await app.inject('/api/error')
    assert.equal(error.statusCode, 500)
    assert.ok(!error.body.includes('database'))
  } finally { await app.close() }
})

test('production route modules attach the authentication limits to their actual endpoints', async () => {
  const app = Fastify()
  await registerRequestSecurity(app)
  const limits = new Map()
  app.addHook('onRoute', (route) => limits.set(route.url, route.config?.rateLimit))
  await (await import('../src/routes/auth.ts')).registerAuthRoutes(app)
  await (await import('../src/routes/email.ts')).registerEmailRoutes(app)
  await (await import('../src/routes/setup.ts')).registerSetupRoutes(app)
  try {
    for (const [url, policy] of [
      ['/api/auth/login', 'login'], ['/api/auth/register', 'register'], ['/api/setup/initialize', 'setup'],
      ['/api/auth/login/totp', 'login'], ['/api/me/totp/setup', 'change'],
      ['/api/me/totp/enable', 'change'], ['/api/me/totp/disable', 'change'],
      ['/api/auth/email-code', 'email'], ['/api/auth/forgot-password', 'email'],
      ['/api/auth/password-reset', 'reset'], ['/api/auth/reset-password', 'reset'],
      ['/api/me/password/code', 'email'], ['/api/me/password', 'change'],
    ]) assert.deepEqual(limits.get(url), authRateLimits[policy], url)
    for (let i = 0; i < 20; i++)
      assert.equal((await app.inject({ method: 'POST', url: '/api/auth/login', payload: {} })).statusCode, 400)
    assert.equal((await app.inject({ method: 'POST', url: '/api/auth/login', payload: {} })).statusCode, 429)
  } finally { await app.close() }
})
