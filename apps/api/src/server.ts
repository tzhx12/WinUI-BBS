import 'dotenv/config'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import multipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import Fastify from 'fastify'
import { query, runMigrations } from './db.js'
import { registerSetupRoutes } from './routes/setup.js'
import { registerAuthRoutes } from './routes/auth.js'
import { registerForumRoutes } from './routes/forum.js'
import { registerAdminRoutes } from './routes/admin.js'
import { registerMediaRoutes } from './routes/media.js'
import { registerInvitationRoutes } from './routes/invitations.js'
import { registerNotificationRoutes } from './routes/notifications.js'
import { registerReportRoutes } from './routes/reports.js'
import { registerReviewRoutes } from './routes/reviews.js'
import { registerEmailRoutes } from './routes/email.js'
import { registerFavoriteRoutes } from './routes/favorites.js'
import {
  registerUpdateRoutes,
  startAutomaticUpdates,
} from './routes/updates.js'
import { setupPath } from './setup.js'
import { currentVersion } from './version.js'
import { registerWebAssets } from './webAssets.js'
import {
  registerRequestSecurity,
  sessionSecret,
  trustedProxies,
} from './requestSecurity.js'
import {
  monitorStorage,
  flushStorageDeletions,
  withStorageLock,
} from './storage.js'

const app = Fastify({
  logger: true,
  bodyLimit: 1_500_000,
  trustProxy: trustedProxies(),
})
const uploadRoot = resolve(process.cwd(), 'data/uploads')

async function start() {
  if (!process.env.DATABASE_URL)
    throw new Error('Set DATABASE_URL in apps/api/.env')
  const secret = sessionSecret()
  await registerRequestSecurity(app)
  await mkdir(uploadRoot, { recursive: true })
  await runMigrations()
  await app.register(cors, {
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
  })
  await app.register(jwt, { secret })
  await app.register(multipart, {
    limits: { fileSize: 100 * 1024 * 1024, files: 1 },
  })
  await app.register(fastifyStatic, { root: uploadRoot, prefix: '/uploads/' })

  app.get('/api/health', async () => ({
    status: 'ok',
    database: 'postgresql',
    version: currentVersion,
  }))
  await registerSetupRoutes(app)
  await registerAuthRoutes(app)
  await registerForumRoutes(app, uploadRoot)
  await registerAdminRoutes(app, uploadRoot)
  await registerInvitationRoutes(app)
  await registerNotificationRoutes(app)
  await registerReportRoutes(app)
  await registerReviewRoutes(app)
  await registerEmailRoutes(app)
  await registerFavoriteRoutes(app)
  await registerMediaRoutes(app, uploadRoot)
  await registerUpdateRoutes(app)

  if (process.env.FORUM_WEB_ROOT) {
    await registerWebAssets(app, process.env.FORUM_WEB_ROOT)
  }

  const storageMaintenance = async () => {
    try {
      await withStorageLock(() => flushStorageDeletions(uploadRoot))
      await monitorStorage(uploadRoot)
    } catch (error) {
      app.log.error(error, 'Storage maintenance failed')
    }
  }
  let checkingStorage = false
  const storageTimer = setInterval(
    async () => {
      if (checkingStorage) return
      checkingStorage = true
      try {
        await storageMaintenance()
      } finally {
        checkingStorage = false
      }
    },
    5 * 60 * 1000,
  )
  storageTimer.unref()
  app.addHook('onClose', async () => clearInterval(storageTimer))
  await storageMaintenance()

  const port = Number(process.env.PORT ?? 4000)
  startAutomaticUpdates(app)
  const address = await app.listen({
    host: process.env.HOST || '127.0.0.1',
    port,
  })
  const entry = await setupPath()
  if (entry) {
    const socket = app.server.address()
    const boundPort = socket && typeof socket !== 'string' ? socket.port : port
    const origin =
      process.env.WEB_ORIGIN ??
      (process.env.FORUM_WEB_ROOT ? `http://127.0.0.1:${boundPort}` : address)
    app.log.info(
      { setupPath: entry, setupUrl: `${origin}${entry}` },
      '首次安装：请通过此安全入口创建管理员',
    )
  }
}

start().catch((error) => {
  app.log.error(error)
  process.exitCode = 1
})
