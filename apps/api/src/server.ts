import 'dotenv/config'
import { randomUUID } from 'node:crypto'
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
import { registerReviewRoutes } from './routes/reviews.js'
import { registerEmailRoutes } from './routes/email.js'
import { registerFavoriteRoutes } from './routes/favorites.js'
import {
  monitorStorage,
  flushStorageDeletions,
  withStorageLock,
} from './storage.js'

const app = Fastify({ logger: true, bodyLimit: 1_500_000 })
const uploadRoot = resolve(process.cwd(), 'data/uploads')

async function start() {
  if (!process.env.DATABASE_URL)
    throw new Error('Set DATABASE_URL in apps/api/.env')
  await mkdir(uploadRoot, { recursive: true })
  await runMigrations()
  await app.register(cors, {
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
  })
  await app.register(jwt, { secret: process.env.JWT_SECRET ?? randomUUID() })
  await app.register(multipart, {
    limits: { fileSize: 100 * 1024 * 1024, files: 1 },
  })
  await app.register(fastifyStatic, { root: uploadRoot, prefix: '/uploads/' })

  app.get('/api/health', async () => ({
    status: 'ok',
    database: 'postgresql',
  }))
  await registerSetupRoutes(app)
  await registerAuthRoutes(app)
  await registerForumRoutes(app, uploadRoot)
  await registerAdminRoutes(app)
  await registerInvitationRoutes(app)
  await registerNotificationRoutes(app)
  await registerReviewRoutes(app)
  await registerEmailRoutes(app)
  await registerFavoriteRoutes(app)
  await registerMediaRoutes(app, uploadRoot)

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
  await app.listen({ host: '127.0.0.1', port })
}

start().catch((error) => {
  app.log.error(error)
  process.exitCode = 1
})
