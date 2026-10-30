import type { FastifyInstance } from 'fastify'
import {
  readFile,
  writeFile,
  rename,
  access,
  constants,
} from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { adminPermissions } from '../auth.js'
import { inTransaction } from '../db.js'
import { readSettings, saveSettings } from '../settings.js'
import {
  compareVersions,
  fetchRelease,
  type UpdateChannel,
} from '../release.js'
import { currentVersion } from '../version.js'

const schema = z.object({
  automatic: z.boolean(),
  channel: z.enum(['releases', 'pre-releases']),
})
type UpdateSettings = z.infer<typeof schema>
export async function updateSettings() {
  return (await readSettings(['update_settings']))
    .update_settings as UpdateSettings
}
async function managedDirectory() {
  const directory = process.env.FORUM_UPDATE_DIR
  if (!directory) return null
  try {
    await access(join(directory, 'enabled'), constants.R_OK)
    return directory
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}
async function jobState(directory: string) {
  try {
    return JSON.parse(
      await readFile(join(directory, 'status.json'), 'utf8'),
    ) as {
      state: string
      message: string
      version?: string
      updatedAt?: string
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}
async function queueUpdate(channel: UpdateChannel) {
  const directory = await managedDirectory()
  if (!directory) throw new Error('此部署未启用更新服务，请使用一键安装部署')
  const id = randomUUID()
  const temporary = join(directory, `request-${id}.tmp`)
  await writeFile(temporary, JSON.stringify({ id, channel }), { mode: 0o640 })
  await rename(temporary, join(directory, 'request.json'))
  return id
}

export async function registerUpdateRoutes(app: FastifyInstance) {
  app.get(
    '/api/admin/updates',
    { preHandler: adminPermissions.settings },
    async () => {
      const directory = await managedDirectory()
      return {
        currentVersion,
        settings: await updateSettings(),
        managed: !!directory,
        job: directory ? await jobState(directory) : null,
      }
    },
  )
  app.patch(
    '/api/admin/updates',
    { preHandler: adminPermissions.settings },
    async (request, reply) => {
      const parsed = schema.safeParse(request.body)
      if (!parsed.success)
        return reply
          .code(400)
          .send({ error: '请选择有效的更新渠道和自动更新状态' })
      if (parsed.data.automatic && !(await managedDirectory()))
        return reply
          .code(409)
          .send({ error: '此部署未启用更新服务，请使用一键安装部署' })
      await inTransaction(async (client) => {
        await saveSettings({ update_settings: parsed.data }, client)
        await client.query(
          "INSERT INTO audit_events (actor_uid,action_key,target_type,details) VALUES ($1,'site.updates.settings','site',$2::jsonb)",
          [request.user.uid, JSON.stringify(parsed.data)],
        )
      })
      return { saved: true }
    },
  )
  app.post(
    '/api/admin/updates/check',
    { preHandler: adminPermissions.settings },
    async (_request, reply) => {
      try {
        const { channel } = await updateSettings()
        const latest = await fetchRelease(channel)
        return {
          currentVersion,
          latest,
          available:
            !!latest && compareVersions(latest.version, currentVersion) > 0,
          checkedAt: new Date().toISOString(),
        }
      } catch (error) {
        return reply.code(502).send({ error: (error as Error).message })
      }
    },
  )
  app.post(
    '/api/admin/updates/install',
    { preHandler: adminPermissions.settings },
    async (request, reply) => {
      if (!(await managedDirectory()))
        return reply
          .code(409)
          .send({ error: '此部署未启用更新服务，请使用一键安装部署' })
      await inTransaction(async (client) => {
        await client.query(
          "INSERT INTO audit_events (actor_uid,action_key,target_type) VALUES ($1,'site.updates.install','site')",
          [request.user.uid],
        )
      })
      const id = await queueUpdate((await updateSettings()).channel)
      return reply.code(202).send({ queued: true, id })
    },
  )
}

export async function checkAutomaticUpdates() {
  const settings = await updateSettings()
  if (settings.automatic && (await managedDirectory()))
    return queueUpdate(settings.channel)
}

export function startAutomaticUpdates(app: FastifyInstance) {
  const check = async () => {
    try {
      await checkAutomaticUpdates()
    } catch (error) {
      app.log.error(error, 'Automatic update check failed')
    }
  }
  const timer = setInterval(check, 60 * 60 * 1000)
  timer.unref()
  app.addHook('onClose', async () => clearInterval(timer))
}
