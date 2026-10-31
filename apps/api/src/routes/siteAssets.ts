import type { FastifyInstance } from 'fastify'
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
    'icon',
    'header-background',
  ] as const) {
    const home = kind === 'home-background'
    const url = home
      ? '/api/admin/home-background'
      : `/api/admin/categories/:id/${kind}`
    const column = kind === 'icon' ? 'icon_image_url' : 'header_background_url'
    app.route({
      method: ['POST', 'DELETE'],
      url,
      preHandler: home
        ? adminPermissions.settings
        : adminPermissions.categories,
      handler: async (request, reply) => {
        const id = home ? null : (request.params as { id: string }).id
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
            const result = home
              ? await client.query(
                  "SELECT setting_value AS url FROM app_settings WHERE setting_key='home_background_url' FOR UPDATE",
                )
              : await client.query(
                  `SELECT ${column} AS url FROM categories WHERE id=$1 FOR UPDATE`,
                  [id],
                )
            if (!result.rowCount) throw mediaError('板块不存在', 404)
            previous = result.rows[0].url
            if (image) next = await writeSiteImage(uploadRoot, image)
            if (home)
              await client.query(
                "UPDATE app_settings SET setting_value=$1::jsonb WHERE setting_key='home_background_url'",
                [JSON.stringify(next)],
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
                home ? 'site' : 'category',
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
  }
}
