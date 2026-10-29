import { resolve } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requirePermission, authenticate, readerLevel } from '../auth.js'
import { awardExperience, inTransaction, query } from '../db.js'
import { contentLimits, contentLimitsSchema, readSettings, saveSettings } from '../settings.js'
import { editorBodySchema, readSubmission, validateContent, withSubmission } from '../content.js'
import { mediaError } from '../media.js'
import { grantLevelInvitations } from '../invitations.js'
import { purgeExpiredPosts, recordPostView } from '../posts.js'
import { replyPage } from '../replies.js'
import { registerReplyRoutes } from './replies.js'

const currentLevel = readerLevel
export async function registerForumRoutes(
  app: FastifyInstance,
  uploadRoot = resolve(process.cwd(), 'data/uploads'),
) {
  await registerReplyRoutes(app, uploadRoot)
  let cleanupTimer: ReturnType<typeof setInterval> | undefined
  app.addHook('onReady', async () => {
    await purgeExpiredPosts()
    cleanupTimer = setInterval(
      () => {
        void purgeExpiredPosts().catch((error) => app.log.error(error, '回收站清理失败'))
      },
      60 * 60 * 1000,
    )
    cleanupTimer.unref()
  })
  app.addHook('onClose', async () => {
    clearInterval(cleanupTimer)
  })
  app.get('/api/site', async () => {
    return readSettings([
      'site_title',
      'site_icon_url',
      'site_url',
      'registration_enabled',
      'registration_mode',
      'posts_require_review',
      'email_security',
      'content_limits',
    ])
  })

  app.get('/api/admin/content-settings', { preHandler: requirePermission('settings.manage') }, async () =>
    contentLimits(),
  )
  app.patch(
    '/api/admin/content-settings',
    { preHandler: requirePermission('settings.manage') },
    async (request, reply) => {
      const parsed = contentLimitsSchema.safeParse(request.body)
      if (!parsed.success)
        return reply.code(400).send({ error: '请检查正文、图片和分页限制，不能超过最大上限' })
      await inTransaction(async (client) => {
        await saveSettings({ content_limits: parsed.data }, client)
        await client.query(
          "INSERT INTO audit_events(actor_uid,action_key,target_type,details) VALUES($1,'content.settings.update','site',$2::jsonb)",
          [request.user.uid, JSON.stringify(parsed.data)],
        )
      })
      return { saved: true }
    },
  )

  app.get('/api/categories', async () => {
    const result = await query<{
      id: string
      parent_id: string | null
      name: string
      slug: string
      description: string
      accent_color: string
      icon_glyph: string
      show_notification: boolean
      requires_review: boolean
      minimum_reader_level: number
      minimum_author_level: number
      sort_order: number
      post_count: string
    }>(
      `SELECT c.id, c.parent_id, c.name, c.slug, c.description, c.accent_color, c.icon_glyph, c.show_notification, c.requires_review,
              c.minimum_reader_level, c.minimum_author_level, c.sort_order,
              COUNT(p.id)::text AS post_count
       FROM categories c LEFT JOIN posts p ON p.category_id = c.id AND p.status = 'published' AND p.deleted_at IS NULL
       GROUP BY c.id ORDER BY c.sort_order, c.name`,
    )
    return result.rows
  })

  app.get('/api/groups/public', async (request, reply) => {
    let uid: string | null = null
    if (request.headers.authorization) {
      const authResult = await authenticate(request, reply)
      if (authResult) return authResult
      uid = request.user.uid
    }
    const result = await query(
      `SELECT g.id, g.name, g.description,
              (SELECT COUNT(*) FROM group_memberships gm WHERE gm.group_id = g.id AND (gm.expires_at IS NULL OR gm.expires_at > NOW()))::int AS member_count,
              ($1::bigint IS NOT NULL AND EXISTS (
                SELECT 1 FROM group_memberships gm WHERE gm.group_id = g.id AND gm.user_uid = $1
                  AND (gm.expires_at IS NULL OR gm.expires_at > NOW())
              )) AS joined
       FROM user_groups g WHERE g.group_type = 'public' AND g.is_joinable = TRUE ORDER BY g.name`,
      [uid],
    )
    return result.rows
  })

  app.post('/api/groups/:id/join', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = await query(
      `INSERT INTO group_memberships (user_uid, group_id)
       SELECT $1, id FROM user_groups WHERE id = $2 AND group_type = 'public' AND is_joinable = TRUE
       ON CONFLICT (user_uid, group_id) DO UPDATE SET expires_at = NULL RETURNING group_id`,
      [request.user.uid, id],
    )
    if (!result.rowCount) {
      const group = await query(
        "SELECT 1 FROM user_groups WHERE id = $1 AND group_type = 'public' AND is_joinable = TRUE",
        [id],
      )
      if (!group.rowCount) return reply.code(404).send({ error: '公开用户组不存在' })
    }
    return { joined: true }
  })

  app.delete('/api/groups/:id/leave', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = await query(
      `DELETE FROM group_memberships gm USING user_groups g
       WHERE gm.group_id = g.id AND gm.group_id = $1 AND gm.user_uid = $2
         AND g.group_type = 'public' AND g.is_joinable = TRUE RETURNING gm.group_id`,
      [id, request.user.uid],
    )
    if (!result.rowCount) {
      const group = await query(
        "SELECT 1 FROM user_groups WHERE id = $1 AND group_type = 'public' AND is_joinable = TRUE",
        [id],
      )
      if (!group.rowCount) return reply.code(404).send({ error: '公开用户组不存在' })
    }
    return { left: true }
  })

  app.get('/api/posts', async (request, reply) => {
    let readerLevel = 0
    if (request.headers.authorization) {
      const authResult = await authenticate(request, reply)
      if (authResult) return authResult
      readerLevel = await currentLevel(request.user.uid)
    }
    const parsed = z
      .object({
        category: z.string().optional(),
        q: z.string().trim().max(120).optional(),
        sort: z.enum(['latest', 'popular']).optional(),
      })
      .safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: '筛选条件无效' })
    const { category, q, sort = 'latest' } = parsed.data
    const result = await query(
      `SELECT p.id, p.title, p.body, p.minimum_reader_level, p.is_pinned, p.view_count, p.created_at,
              c.id AS category_id, c.name AS category_name, c.accent_color AS category_color,
              u.uid AS author_uid, u.username, u.display_name, u.avatar_url, u.experience, u.level_offset,
              (SELECT COUNT(*) FROM replies r WHERE r.post_id = p.id AND r.deleted_at IS NULL)::int AS reply_count,
              (SELECT COUNT(*) FROM post_likes l WHERE l.post_id = p.id)::int AS like_count
       FROM posts p JOIN categories c ON c.id = p.category_id JOIN users u ON u.uid = p.author_uid
       WHERE p.status = 'published' AND p.deleted_at IS NULL AND p.minimum_reader_level <= $1
         AND c.minimum_reader_level <= $1
         AND ($2::bigint IS NULL OR c.id = $2)
         AND ($3::text IS NULL OR p.title ILIKE '%' || $3 || '%' OR p.body::text ILIKE '%' || $3 || '%')
       ORDER BY p.is_pinned DESC, ${sort === 'popular' ? '(SELECT COUNT(*) FROM replies r WHERE r.post_id = p.id AND r.deleted_at IS NULL) DESC,' : ''} p.created_at DESC
       LIMIT 60`,
      [readerLevel, category ?? null, q ?? null],
    )
    return result.rows
  })

  app.get('/api/me/posts', { preHandler: authenticate }, async (request) => {
    const result = await query(
      `SELECT p.id, p.title, p.body, p.minimum_reader_level, p.is_pinned, p.view_count, p.status, p.created_at,
              c.id AS category_id, c.name AS category_name, c.accent_color AS category_color,
              u.uid AS author_uid, u.username, u.display_name, u.avatar_url, u.experience, u.level_offset,
              (SELECT COUNT(*) FROM replies r WHERE r.post_id = p.id AND r.deleted_at IS NULL)::int AS reply_count,
              (SELECT COUNT(*) FROM post_likes l WHERE l.post_id = p.id)::int AS like_count
       FROM posts p JOIN categories c ON c.id = p.category_id JOIN users u ON u.uid = p.author_uid
       WHERE p.author_uid = $1 AND p.deleted_at IS NULL ORDER BY p.created_at DESC LIMIT 100`,
      [request.user.uid],
    )
    return result.rows
  })

  app.delete('/api/me/posts/:id', { preHandler: authenticate }, async (request, reply) => {
    const result = await query(
      `UPDATE posts SET deleted_at = NOW(), deletion_source = 'author', deleted_by = $2,
      purge_after = NOW() + (SELECT setting_value::text::integer FROM app_settings WHERE setting_key = 'trash_retention_days') * INTERVAL '1 day'
      WHERE id = $1 AND author_uid = $2 AND deleted_at IS NULL RETURNING id, deleted_at, purge_after`,
      [(request.params as { id: string }).id, request.user.uid],
    )
    if (!result.rows[0]) return reply.code(404).send({ error: '帖子不存在或不属于你' })
    return result.rows[0]
  })

  app.get('/api/me/trash', { preHandler: authenticate }, async (request) => {
    return (
      await query(
        `SELECT p.id, p.title, p.status, p.deleted_at, p.purge_after, c.name AS category_name
      FROM posts p JOIN categories c ON c.id = p.category_id
      WHERE p.author_uid = $1 AND p.deleted_at IS NOT NULL AND p.deletion_source = 'author' AND p.purge_after > NOW()
      ORDER BY p.deleted_at DESC`,
        [request.user.uid],
      )
    ).rows
  })

  app.get('/api/me/trash/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const post = await query(
      `SELECT p.id, p.category_id, p.title, p.body, p.status, p.is_pinned, p.minimum_reader_level,
      p.view_count, p.created_at, p.deleted_at, p.purge_after, p.review_reason,
      c.name AS category_name, c.accent_color AS category_color,
      u.uid AS author_uid, u.username, u.display_name, u.avatar_url, u.experience, u.level_offset
      FROM posts p JOIN categories c ON c.id = p.category_id JOIN users u ON u.uid = p.author_uid
      WHERE p.id = $1 AND p.author_uid = $2 AND p.deleted_at IS NOT NULL AND p.deletion_source = 'author' AND p.purge_after > NOW()`,
      [id, request.user.uid],
    )
    if (!post.rows[0]) return reply.code(404).send({ error: '回收站帖子不存在' })
    const likes = await query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM post_likes WHERE post_id = $1',
      [id],
    )
    return {
      post: post.rows[0],
      ...(await replyPage(request, id)),
      likeCount: likes.rows[0]!.count,
    }
  })

  app.post('/api/me/trash/:id/restore', { preHandler: authenticate }, async (request, reply) => {
    const result = await query(
      `UPDATE posts SET deleted_at = NULL, purge_after = NULL, deleted_by = NULL, updated_at = NOW()
      WHERE id = $1 AND author_uid = $2 AND deleted_at IS NOT NULL AND deletion_source = 'author' AND purge_after > NOW() RETURNING id, status`,
      [(request.params as { id: string }).id, request.user.uid],
    )
    if (!result.rows[0]) return reply.code(404).send({ error: '回收站帖子不存在或已到期' })
    return result.rows[0]
  })

  app.get('/api/posts/:id', async (request, reply) => {
    let readerLevel = 0
    let uid: string | null = null
    if (request.headers.authorization) {
      const authResult = await authenticate(request, reply)
      if (authResult) return authResult
      readerLevel = await currentLevel(request.user.uid)
      uid = request.user.uid
    }
    const { id } = request.params as { id: string }
    const post = await query(
      `SELECT p.id, p.category_id, p.title, p.body, p.status, p.is_pinned, p.minimum_reader_level,
              p.view_count, p.created_at, p.review_reason, c.name AS category_name, c.accent_color AS category_color,
              c.minimum_reader_level AS category_minimum_reader_level,
              u.uid AS author_uid, u.username, u.display_name, u.avatar_url, u.experience, u.level_offset
       FROM posts p JOIN categories c ON c.id = p.category_id JOIN users u ON u.uid = p.author_uid
       WHERE p.id = $1 AND p.deleted_at IS NULL
         AND (p.status IN ('published', 'hidden') OR p.author_uid = $2)`,
      [id, uid],
    )
    if (!post.rows[0]) return reply.code(404).send({ error: '帖子不存在' })
    if (
      post.rows[0].author_uid !== uid &&
      (Number(post.rows[0].minimum_reader_level) > readerLevel ||
        Number(post.rows[0].category_minimum_reader_level) > readerLevel)
    ) {
      return reply.code(403).send({ error: '此帖需要更高等级才能阅读' })
    }
    if (['published', 'hidden'].includes(post.rows[0].status)) {
      const viewCount = await recordPostView(app, request, reply, id)
      if (viewCount === null) return reply.code(404).send({ error: '帖子不存在' })
      post.rows[0].view_count = viewCount
    }
    const likes = await query<{ count: number; liked: boolean }>(
      'SELECT COUNT(*)::int AS count, COALESCE(bool_or(user_uid=$2::bigint),FALSE) AS liked FROM post_likes WHERE post_id = $1',
      [id, uid],
    )
    return {
      post: post.rows[0],
      ...(await replyPage(request, id)),
      likeCount: likes.rows[0]?.count ?? 0,
      liked: likes.rows[0]?.liked ?? false,
    }
  })

  app.post('/api/posts', { preHandler: requirePermission('posts.create') }, async (request, reply) => {
    const submission = await readSubmission(request)
    const parsed = z
      .object({
        categoryId: z.string().regex(/^\d+$/),
        title: z.string().trim().min(4).max(180),
        body: editorBodySchema,
        minimumReaderLevel: z.number().int().min(0).default(0),
      })
      .safeParse(submission.payload)
    if (!parsed.success) return reply.code(400).send({ error: '请填写标题、版块和正文' })
    await validateContent(parsed.data.body, 'post')
    if (parsed.data.minimumReaderLevel > 0) {
      const permission = await query(
        `SELECT 1 FROM group_memberships gm JOIN group_permissions gp ON gp.group_id = gm.group_id
        WHERE gm.user_uid = $1 AND gp.permission_key = 'posts.set_reader_level' AND (gm.expires_at IS NULL OR gm.expires_at > NOW()) LIMIT 1`,
        [request.user.uid],
      )
      if (!permission.rowCount) return reply.code(403).send({ error: '当前用户组没有设定最低阅读等级的权限' })
    }
    const authorLevel = await currentLevel(request.user.uid)
    const category = await query<{
      minimum_author_level: number
      requires_review: boolean
    }>('SELECT minimum_author_level, requires_review FROM categories WHERE id = $1', [parsed.data.categoryId])
    if (!category.rows[0]) return reply.code(404).send({ error: '版块不存在' })
    if (authorLevel < category.rows[0].minimum_author_level)
      return reply.code(403).send({ error: '当前等级不能在此版块发帖' })
    const [settings, permissions] = await Promise.all([
      readSettings(['posts_require_review']),
      query<{ permission_key: string }>(
        `SELECT DISTINCT gp.permission_key FROM group_memberships gm JOIN group_permissions gp ON gp.group_id = gm.group_id
         WHERE gm.user_uid = $1 AND gp.permission_key IN ('posts.require_review', 'posts.bypass_review')
           AND (gm.expires_at IS NULL OR gm.expires_at > NOW())`,
        [request.user.uid],
      ),
    ])
    const keys = permissions.rows.map((row) => row.permission_key)
    const requiresReview =
      keys.includes('posts.require_review') ||
      (!keys.includes('posts.bypass_review') &&
        (settings.posts_require_review || category.rows[0].requires_review))
    const result = await withSubmission(
      request.user.uid,
      parsed.data.body,
      submission.attachments,
      uploadRoot,
      async (client) => {
        const created = await client.query(
          `INSERT INTO posts (category_id, author_uid, title, body, minimum_reader_level, status, author_ip)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7) RETURNING id, status`,
          [
            parsed.data.categoryId,
            request.user.uid,
            parsed.data.title,
            JSON.stringify(parsed.data.body),
            parsed.data.minimumReaderLevel,
            requiresReview ? 'pending' : 'published',
            request.ip,
          ],
        )
        const experience = await awardExperience(request.user.uid, 'create_post', client)
        await grantLevelInvitations(request.user.uid, client)
        return { post: created.rows[0], experience }
      },
    )
    return reply.code(201).send(result)
  })

  app.post('/api/posts/:id/like', { preHandler: authenticate }, async (request) => {
    const { id } = request.params as { id: string }
    const post = await query<{
      minimum_reader_level: number
      category_minimum_reader_level: number
    }>(
      `SELECT p.minimum_reader_level, c.minimum_reader_level AS category_minimum_reader_level
       FROM posts p JOIN categories c ON c.id = p.category_id WHERE p.id = $1 AND p.status IN ('published', 'hidden') AND p.deleted_at IS NULL`,
      [id],
    )
    if (
      !post.rows[0] ||
      Math.max(post.rows[0].minimum_reader_level, post.rows[0].category_minimum_reader_level) >
        (await currentLevel(request.user.uid))
    ) {
      return { liked: false }
    }
    const result = await query(
      `DELETE FROM post_likes WHERE post_id = $1 AND user_uid = $2 RETURNING post_id`,
      [id, request.user.uid],
    )
    if (!result.rowCount) {
      await query('INSERT INTO post_likes (post_id, user_uid) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
        id,
        request.user.uid,
      ])
      return { liked: true }
    }
    return { liked: false }
  })
}
