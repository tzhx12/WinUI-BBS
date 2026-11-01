import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { adminPermissions } from '../auth.js'
import { inTransaction } from '../db.js'
import { mediaError } from '../media.js'
import {
  isSiteAssetKey,
  readSiteImage,
  removeSiteAsset,
  removeSiteAssetIfUnused,
  siteAssetRoot,
  writeSiteImage,
} from '../siteAssets.js'

export async function registerSiteAssetRoutes(
  app: FastifyInstance,
  uploadRoot: string,
) {
  app.get('/site-assets/:key', async (request, reply) => {
    const { key } = request.params as { key: string }
    if (!isSiteAssetKey(key))
      return reply.code(404).send({ error: '图片不存在' })
    return reply
      .header('X-Content-Type-Options', 'nosniff')
      .sendFile(key, siteAssetRoot(uploadRoot))
  })

  for (const kind of [
    'home-background',
    'popular-background',
    'icon',
    'header-background',
  ] as const) {
    const site = kind === 'home-background' || kind === 'popular-background'
    const settingKey =
      kind === 'popular-background'
        ? 'popular_background_url'
        : 'home_background_url'
    const url = site
      ? `/api/admin/${kind}`
      : `/api/admin/categories/:id/${kind}`
    const column = kind === 'icon' ? 'icon_image_url' : 'header_background_url'
    app.route({
      method: ['POST', 'DELETE'],
      url,
      preHandler: site
        ? adminPermissions.settings
        : adminPermissions.categories,
      handler: async (request, reply) => {
        const id = site ? null : (request.params as { id: string }).id
        if (id !== null && !/^\d+$/.test(id))
          throw mediaError('板块不存在', 404)
        const image =
          request.method === 'POST'
            ? await readSiteImage(request, kind === 'icon')
            : null
        let next = ''
        let previous = ''
        try {
          await inTransaction(async (client) => {
            const result = site
              ? await client.query(
                  'SELECT setting_value AS url FROM app_settings WHERE setting_key=$1 FOR UPDATE',
                  [settingKey],
                )
              : await client.query(
                  `SELECT ${column} AS url FROM categories WHERE id=$1 FOR UPDATE`,
                  [id],
                )
            if (!result.rowCount) throw mediaError('板块不存在', 404)
            previous = result.rows[0].url
            if (image) next = await writeSiteImage(uploadRoot, image)
            if (site)
              await client.query(
                'UPDATE app_settings SET setting_value=$1::jsonb WHERE setting_key=$2',
                [JSON.stringify(next), settingKey],
              )
            else
              await client.query(
                `UPDATE categories SET ${column}=$2 WHERE id=$1`,
                [id, next],
              )
            await client.query(
              'INSERT INTO audit_events(actor_uid,action_key,target_type,target_id,details) VALUES($1,$2,$3,$4,$5::jsonb)',
              [
                request.user.uid,
                `community.image.${image ? 'upload' : 'remove'}`,
                site ? 'site' : 'category',
                id,
                JSON.stringify({ kind, url: next }),
              ],
            )
          })
        } catch (error) {
          if (next) await removeSiteAsset(uploadRoot, next, app.log)
          throw error
        }
        if (previous && previous !== next)
          await removeSiteAssetIfUnused(uploadRoot, previous, app.log)
        return reply.code(image ? 201 : 200).send({ url: next })
      },
    })
    if (kind === 'popular-background' || kind === 'header-background') {
      app.patch(
        url,
        {
          preHandler: site
            ? adminPermissions.settings
            : adminPermissions.categories,
        },
        async (request, reply) => {
          const parsed = z
            .object({ height: z.union([z.literal(50), z.literal(75)]) })
            .strict()
            .safeParse(request.body)
          if (!parsed.success)
            return reply
              .code(400)
              .send({ error: '背景显示范围只能选择半屏或 3/4 屏' })
          const id = site ? null : (request.params as { id: string }).id
          if (id !== null && !/^\d+$/.test(id))
            throw mediaError('板块不存在', 404)
          await inTransaction(async (client) => {
            const result = site
              ? await client.query(
                  "UPDATE app_settings SET setting_value=$1::jsonb WHERE setting_key='popular_background_height'",
                  [JSON.stringify(parsed.data.height)],
                )
              : await client.query(
                  'UPDATE categories SET header_background_height=$2 WHERE id=$1',
                  [id, parsed.data.height],
                )
            if (!result.rowCount) throw mediaError('板块不存在', 404)
            await client.query(
              "INSERT INTO audit_events(actor_uid,action_key,target_type,target_id,details) VALUES($1,'community.background.update',$2,$3,$4::jsonb)",
              [
                request.user.uid,
                site ? 'site' : 'category',
                id,
                JSON.stringify({ kind, height: parsed.data.height }),
              ],
            )
          })
          return { height: parsed.data.height }
        },
      )
    }
  }
}
