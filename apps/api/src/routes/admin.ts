import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { adminPermissions } from '../auth.js'
import { effectiveLevel, inTransaction, query } from '../db.js'
import { httpUrl, mediaLimitsSchema, readSettings, saveSettings } from '../settings.js'
import { grantLevelInvitations } from '../invitations.js'
import { groupPermissionError, permissionKeys } from '../permissions.js'

const groupTypes = ['management', 'public', 'normal', 'temporary', 'special'] as const

async function audit(
  actorUid: string,
  action: string,
  type: string,
  id: string | null,
  details: unknown = {},
) {
  await query(
    'INSERT INTO audit_events (actor_uid, action_key, target_type, target_id, details) VALUES ($1, $2, $3, $4, $5::jsonb)',
    [actorUid, action, type, id, JSON.stringify(details)],
  )
}

export async function registerAdminRoutes(app: FastifyInstance) {
  app.get('/api/admin/overview', { preHandler: adminPermissions.users }, async () => {
    const result = await query<{
      users: string
      posts: string
      replies: string
      checkins: string
      pending: string
      media: string
    }>(
      `SELECT
        (SELECT COUNT(*) FROM users)::text AS users,
        (SELECT COUNT(*) FROM posts WHERE status = 'published' AND deleted_at IS NULL)::text AS posts,
        (SELECT COUNT(*) FROM replies)::text AS replies,
        (SELECT COUNT(*) FROM daily_checkins WHERE checkin_date = CURRENT_DATE)::text AS checkins,
        (SELECT COUNT(*) FROM posts WHERE status = 'pending' AND deleted_at IS NULL)::text AS pending,
        (SELECT COUNT(*) FROM media_assets)::text AS media`,
    )
    const activity = await query(
      `SELECT to_char(date_bucket::date, 'YYYY-MM-DD') AS day, COUNT(p.id)::int AS posts
       FROM generate_series(CURRENT_DATE - 6, CURRENT_DATE, interval '1 day') AS date_bucket
       LEFT JOIN posts p ON p.created_at::date = date_bucket::date AND p.deleted_at IS NULL
       GROUP BY date_bucket ORDER BY date_bucket`,
    )
    const groups = await query(
      'SELECT id, name, group_type, (SELECT COUNT(*) FROM group_memberships gm WHERE gm.group_id = user_groups.id AND (gm.expires_at IS NULL OR gm.expires_at > NOW()))::int AS member_count FROM user_groups ORDER BY name',
    )
    return {
      stats: result.rows[0],
      activity: activity.rows,
      groups: groups.rows,
    }
  })

  app.get('/api/admin/users', { preHandler: adminPermissions.users }, async (request) => {
    const parsed = z.object({ q: z.string().trim().max(80).optional() }).safeParse(request.query)
    const search = parsed.success ? (parsed.data.q ?? null) : null
    const setting = await query<{ points_per_level: number }>(
      "SELECT setting_value::text::integer AS points_per_level FROM app_settings WHERE setting_key = 'points_per_level'",
    )
    const perLevel = Math.max(1, setting.rows[0]?.points_per_level ?? 100)
    const result = await query(
      `SELECT u.uid, u.uuid, u.username, u.email, u.display_name, u.experience, u.level_offset, u.status, u.created_at,
              u.banned_until, COALESCE(u.banned_until > NOW(), FALSE) AS is_banned,
              GREATEST(1, FLOOR(u.experience::numeric / $2)::int + 1 + u.level_offset) AS level,
              COALESCE(array_agg(DISTINCT g.name) FILTER (WHERE g.id IS NOT NULL), '{}') AS groups
       FROM users u
       LEFT JOIN group_memberships gm ON gm.user_uid = u.uid AND (gm.expires_at IS NULL OR gm.expires_at > NOW())
       LEFT JOIN user_groups g ON g.id = gm.group_id
       WHERE $1::text IS NULL OR u.username ILIKE '%' || $1 || '%' OR u.email ILIKE '%' || $1 || '%' OR u.display_name ILIKE '%' || $1 || '%'
       GROUP BY u.uid ORDER BY u.uid DESC LIMIT 200`,
      [search, perLevel],
    )
    return result.rows
  })

  app.patch('/api/admin/users/:uid', { preHandler: adminPermissions.users }, async (request, reply) => {
    const parsed = z
      .object({
        level: z.number().int().min(1).max(10000).optional(),
        status: z.enum(['active', 'suspended']).optional(),
        banMinutes: z
          .number()
          .int()
          .min(30)
          .max(1095 * 24 * 60)
          .nullable()
          .optional(),
        displayName: z.string().trim().min(1).max(48).optional(),
      })
      .refine((value) => Object.keys(value).length > 0)
      .safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: '请提供需要调整的用户字段' })
    const { uid } = request.params as { uid: string }
    const current = await query<{ experience: string; level_offset: number }>(
      'SELECT experience, level_offset FROM users WHERE uid = $1',
      [uid],
    )
    if (!current.rows[0]) return reply.code(404).send({ error: '用户不存在' })
    const changes = parsed.data
    if (changes.status === 'suspended' || changes.banMinutes != null) {
      const access = await query<{
        is_manager: boolean
        another_manager: boolean
      }>(
        `SELECT
           EXISTS (SELECT 1 FROM group_memberships gm JOIN group_permissions gp ON gp.group_id = gm.group_id
                   WHERE gm.user_uid = $1 AND gp.permission_key = 'groups.manage'
                     AND (gm.expires_at IS NULL OR gm.expires_at > NOW())) AS is_manager,
           EXISTS (SELECT 1 FROM group_memberships gm JOIN group_permissions gp ON gp.group_id = gm.group_id
                   JOIN users u ON u.uid = gm.user_uid
                   WHERE gm.user_uid <> $1 AND u.status = 'active' AND (u.banned_until IS NULL OR u.banned_until <= NOW()) AND gp.permission_key = 'groups.manage'
                     AND (gm.expires_at IS NULL OR gm.expires_at > NOW())) AS another_manager`,
        [uid],
      )
      if (access.rows[0]?.is_manager && !access.rows[0]?.another_manager)
        return reply.code(409).send({ error: '至少保留一位可管理用户组的活跃账号' })
    }
    const set: string[] = []
    const values: unknown[] = []
    if (changes.status) {
      values.push(changes.status)
      set.push(`status = $${values.length}`)
    }
    if (changes.banMinutes !== undefined) {
      values.push(changes.banMinutes)
      set.push(
        `banned_until = CASE WHEN $${values.length}::integer IS NULL THEN NULL ELSE NOW() + $${values.length} * INTERVAL '1 minute' END`,
      )
    }
    if (changes.displayName) {
      values.push(changes.displayName)
      set.push(`display_name = $${values.length}`)
    }
    if (changes.level !== undefined) {
      const level = await effectiveLevel(current.rows[0].experience, 0)
      values.push(changes.level - level)
      set.push(`level_offset = $${values.length}`)
    }
    values.push(uid)
    const updated = await query(
      `UPDATE users SET ${set.join(', ')} WHERE uid = $${values.length}
       RETURNING uid, username, display_name, experience, level_offset, status, banned_until`,
      values,
    )
    if (changes.level !== undefined) await grantLevelInvitations(uid)
    await audit(request.user.uid, 'user.update', 'user', uid, changes)
    return updated.rows[0]
  })

  app.get('/api/admin/groups', { preHandler: adminPermissions.groups }, async () => {
    const result = await query(
      `SELECT g.id, g.name, g.group_type, g.description, g.is_joinable, g.is_default, g.is_protected, g.media_limits,
              COALESCE((SELECT array_agg(permission_key ORDER BY permission_key) FROM group_permissions gp WHERE gp.group_id = g.id), '{}') AS permissions,
              (SELECT COUNT(*) FROM group_memberships gm WHERE gm.group_id = g.id AND (gm.expires_at IS NULL OR gm.expires_at > NOW()))::int AS member_count
       FROM user_groups g ORDER BY g.name`,
    )
    return result.rows
  })

  app.get('/api/admin/groups/:id/memberships', { preHandler: adminPermissions.groups }, async (request) => {
    const { id } = request.params as { id: string }
    const result = await query(
      `SELECT u.uid, u.uuid, u.username, u.display_name, u.email, gm.expires_at, gm.joined_at
       FROM group_memberships gm JOIN users u ON u.uid = gm.user_uid
       WHERE gm.group_id = $1 ORDER BY u.uid`,
      [id],
    )
    return result.rows
  })

  app.post('/api/admin/groups', { preHandler: adminPermissions.groups }, async (request, reply) => {
    const parsed = z
      .object({
        name: z.string().trim().min(2).max(48),
        groupType: z.enum(groupTypes),
        description: z.string().max(500).default(''),
        isJoinable: z.boolean().default(false),
        permissions: z.array(z.enum(permissionKeys)).default([]),
        mediaLimits: mediaLimitsSchema.partial().default({}),
      })
      .safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: '用户组资料无效' })
    const permissionError = groupPermissionError(parsed.data.groupType, parsed.data.permissions)
    if (permissionError) return reply.code(400).send({ error: permissionError })
    try {
      const created = await inTransaction(async (client) => {
        const group = await client.query(
          'INSERT INTO user_groups (name, group_type, description, is_joinable, media_limits) VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING id',
          [
            parsed.data.name,
            parsed.data.groupType,
            parsed.data.description,
            parsed.data.isJoinable,
            JSON.stringify(parsed.data.mediaLimits),
          ],
        )
        for (const permission of parsed.data.permissions) {
          await client.query('INSERT INTO group_permissions (group_id, permission_key) VALUES ($1, $2)', [
            group.rows[0].id,
            permission,
          ])
        }
        return group.rows[0]
      })
      await audit(request.user.uid, 'group.create', 'group', String(created.id), parsed.data)
      return reply.code(201).send(created)
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        return reply.code(409).send({ error: '用户组名称已存在' })
      if ((error as { code?: string }).code === '23514')
        return reply.code(400).send({ error: (error as Error).message })
      throw error
    }
  })

  app.patch('/api/admin/groups/:id', { preHandler: adminPermissions.groups }, async (request, reply) => {
    const parsed = z
      .object({
        name: z.string().trim().min(2).max(48).optional(),
        groupType: z.enum(groupTypes).optional(),
        description: z.string().max(500).optional(),
        isJoinable: z.boolean().optional(),
        permissions: z.array(z.enum(permissionKeys)).optional(),
        mediaLimits: mediaLimitsSchema.partial().optional(),
      })
      .refine((value) => Object.keys(value).length > 0)
      .safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: '请提供需要更新的字段' })
    const { id } = request.params as { id: string }
    const data = parsed.data
    if (data.permissions && !data.permissions.includes('groups.manage')) {
      const access = await query<{
        is_manager_group: boolean
        has_active_member: boolean
        another_manager: boolean
      }>(
        `SELECT
           EXISTS (SELECT 1 FROM group_permissions WHERE group_id = $1 AND permission_key = 'groups.manage') AS is_manager_group,
           EXISTS (SELECT 1 FROM group_memberships gm JOIN users u ON u.uid = gm.user_uid
                   WHERE gm.group_id = $1 AND u.status = 'active' AND (u.banned_until IS NULL OR u.banned_until <= NOW()) AND (gm.expires_at IS NULL OR gm.expires_at > NOW())) AS has_active_member,
           EXISTS (SELECT 1 FROM group_memberships gm JOIN group_permissions gp ON gp.group_id = gm.group_id
                   JOIN users u ON u.uid = gm.user_uid
                   WHERE gm.group_id <> $1 AND u.status = 'active' AND (u.banned_until IS NULL OR u.banned_until <= NOW()) AND gp.permission_key = 'groups.manage'
                     AND (gm.expires_at IS NULL OR gm.expires_at > NOW())) AS another_manager`,
        [id],
      )
      const currentAccess = access.rows[0]
      if (
        currentAccess?.is_manager_group &&
        currentAccess.has_active_member &&
        !currentAccess.another_manager
      ) {
        return reply.code(409).send({ error: '先为其他活跃用户组授予管理权限' })
      }
    }
    const set: string[] = []
    const values: unknown[] = []
    if (data.mediaLimits !== undefined) {
      values.push(JSON.stringify(data.mediaLimits))
      set.push(`media_limits = $${values.length}::jsonb`)
    }
    for (const [key, column] of [
      ['name', 'name'],
      ['groupType', 'group_type'],
      ['description', 'description'],
      ['isJoinable', 'is_joinable'],
    ] as const) {
      if (data[key] !== undefined) {
        values.push(data[key])
        set.push(`${column} = $${values.length}`)
      }
    }
    try {
      const result = await inTransaction(async (client) => {
        const current = await client.query<{ group_type: string; permissions: string[] }>(
          `SELECT g.group_type, ARRAY(SELECT permission_key FROM group_permissions WHERE group_id = g.id) AS permissions
           FROM user_groups g WHERE g.id = $1 FOR UPDATE`,
          [id],
        )
        if (!current.rows[0]) return null
        const permissionError = groupPermissionError(
          data.groupType ?? current.rows[0].group_type,
          data.permissions ?? current.rows[0].permissions,
        )
        if (permissionError) throw Object.assign(new Error(permissionError), { statusCode: 400 })
        if (set.length) {
          values.push(id)
          const update = await client.query(
            `UPDATE user_groups SET ${set.join(', ')} WHERE id = $${values.length} RETURNING id`,
            values,
          )
          if (!update.rows[0]) return null
        }
        if (data.permissions) {
          await client.query('DELETE FROM group_permissions WHERE group_id = $1', [id])
          for (const permission of data.permissions)
            await client.query('INSERT INTO group_permissions (group_id, permission_key) VALUES ($1, $2)', [
              id,
              permission,
            ])
        }
        return { id }
      })
      if (!result) return reply.code(404).send({ error: '用户组不存在' })
      await audit(request.user.uid, 'group.update', 'group', id, data)
      return result
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        return reply.code(409).send({ error: '用户组名称已存在' })
      if ((error as { code?: string }).code === '23514')
        return reply.code(400).send({ error: (error as Error).message })
      throw error
    }
  })

  app.delete('/api/admin/groups/:id', { preHandler: adminPermissions.groups }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const access = await query<{
      is_manager_group: boolean
      has_active_member: boolean
      another_manager: boolean
    }>(
      `SELECT
         EXISTS (SELECT 1 FROM group_permissions WHERE group_id = $1 AND permission_key = 'groups.manage') AS is_manager_group,
         EXISTS (SELECT 1 FROM group_memberships gm JOIN users u ON u.uid = gm.user_uid
                 WHERE gm.group_id = $1 AND u.status = 'active' AND (u.banned_until IS NULL OR u.banned_until <= NOW()) AND (gm.expires_at IS NULL OR gm.expires_at > NOW())) AS has_active_member,
         EXISTS (SELECT 1 FROM group_memberships gm JOIN group_permissions gp ON gp.group_id = gm.group_id
                 JOIN users u ON u.uid = gm.user_uid
                 WHERE gm.group_id <> $1 AND u.status = 'active' AND (u.banned_until IS NULL OR u.banned_until <= NOW()) AND gp.permission_key = 'groups.manage'
                   AND (gm.expires_at IS NULL OR gm.expires_at > NOW())) AS another_manager`,
      [id],
    )
    const currentAccess = access.rows[0]
    if (
      currentAccess?.is_manager_group &&
      currentAccess.has_active_member &&
      !currentAccess.another_manager
    ) {
      return reply.code(409).send({ error: '先为其他活跃用户组授予管理权限' })
    }
    const result = await query(
      'DELETE FROM user_groups WHERE id = $1 AND is_default = FALSE AND is_protected = FALSE RETURNING id',
      [id],
    )
    if (!result.rowCount) return reply.code(404).send({ error: '用户组不存在或为系统组' })
    await audit(request.user.uid, 'group.delete', 'group', id)
    return { deleted: true }
  })

  app.post(
    '/api/admin/groups/:id/memberships',
    { preHandler: adminPermissions.groups },
    async (request, reply) => {
      const parsed = z
        .object({
          userUid: z.string().regex(/^\d+$/),
          expiresAt: z.iso.datetime().nullable().optional(),
        })
        .safeParse(request.body)
      if (!parsed.success) return reply.code(400).send({ error: '成员资料无效' })
      const { id } = request.params as { id: string }
      await query(
        `INSERT INTO group_memberships (user_uid, group_id, expires_at)
       VALUES ($1, $2, $3) ON CONFLICT (user_uid, group_id) DO UPDATE SET expires_at = EXCLUDED.expires_at`,
        [parsed.data.userUid, id, parsed.data.expiresAt ?? null],
      )
      await audit(request.user.uid, 'group.member.add', 'group', id, parsed.data)
      return reply.code(201).send({ added: true })
    },
  )

  app.delete(
    '/api/admin/groups/:id/memberships/:uid',
    { preHandler: adminPermissions.groups },
    async (request, reply) => {
      const { id, uid } = request.params as { id: string; uid: string }
      const access = await query<{ removing_last_manager: boolean }>(
        `SELECT
         EXISTS (SELECT 1 FROM group_memberships target
                 JOIN group_permissions gp ON gp.group_id = target.group_id
                 JOIN users u ON u.uid = target.user_uid
                 WHERE target.group_id = $1 AND target.user_uid = $2 AND u.status = 'active' AND (u.banned_until IS NULL OR u.banned_until <= NOW())
                   AND gp.permission_key = 'groups.manage'
                   AND (target.expires_at IS NULL OR target.expires_at > NOW())
                   AND NOT EXISTS (
                     SELECT 1 FROM group_memberships other
                     JOIN group_permissions other_gp ON other_gp.group_id = other.group_id
                     JOIN users other_user ON other_user.uid = other.user_uid
                     WHERE other.user_uid = $2 AND other.group_id <> $1 AND other_user.status = 'active' AND (other_user.banned_until IS NULL OR other_user.banned_until <= NOW())
                       AND other_gp.permission_key = 'groups.manage'
                       AND (other.expires_at IS NULL OR other.expires_at > NOW())
                   )
                   AND NOT EXISTS (
                     SELECT 1 FROM group_memberships other
                     JOIN group_permissions other_gp ON other_gp.group_id = other.group_id
                     JOIN users other_user ON other_user.uid = other.user_uid
                     WHERE other.user_uid <> $2 AND other_user.status = 'active' AND (other_user.banned_until IS NULL OR other_user.banned_until <= NOW())
                       AND other_gp.permission_key = 'groups.manage'
                       AND (other.expires_at IS NULL OR other.expires_at > NOW())
                   )) AS removing_last_manager`,
        [id, uid],
      )
      if (access.rows[0]?.removing_last_manager)
        return reply.code(409).send({ error: '至少保留一位可管理用户组的活跃账号' })
      await query('DELETE FROM group_memberships WHERE group_id = $1 AND user_uid = $2', [id, uid])
      await audit(request.user.uid, 'group.member.remove', 'group', id, {
        userUid: uid,
      })
      return { removed: true }
    },
  )

  app.get('/api/admin/categories', { preHandler: adminPermissions.categories }, async () => {
    const result = await query(
      `SELECT c.*, COUNT(DISTINCT p.id)::int AS post_count
       FROM categories c LEFT JOIN posts p ON p.category_id = c.id AND p.deleted_at IS NULL
       GROUP BY c.id ORDER BY c.sort_order, c.name`,
    )
    return result.rows
  })

  app.post('/api/admin/categories', { preHandler: adminPermissions.categories }, async (request, reply) => {
    const parsed = z
      .object({
        parentId: z.string().regex(/^\d+$/).nullable().optional(),
        name: z.string().trim().min(2).max(64),
        slug: z
          .string()
          .trim()
          .toLowerCase()
          .regex(/^[a-z0-9-]+$/)
          .max(72),
        description: z.string().max(500).default(''),
        accentColor: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .default('#d85b45'),
        iconGlyph: z
          .string()
          .regex(/^[\uE700-\uF8FF]$/u)
          .default('\ue8b7'),
        showNotification: z.boolean().default(false),
        requiresReview: z.boolean().default(false),
        minimumReaderLevel: z.number().int().min(0).default(0),
        minimumAuthorLevel: z.number().int().min(1).default(1),
        sortOrder: z.number().int().default(0),
      })
      .safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: '版块资料无效' })
    try {
      const result = await query(
        `INSERT INTO categories (parent_id, name, slug, description, accent_color, minimum_reader_level, minimum_author_level, sort_order, icon_glyph, show_notification, requires_review)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
        [
          parsed.data.parentId ?? null,
          parsed.data.name,
          parsed.data.slug,
          parsed.data.description,
          parsed.data.accentColor,
          parsed.data.minimumReaderLevel,
          parsed.data.minimumAuthorLevel,
          parsed.data.sortOrder,
          parsed.data.iconGlyph,
          parsed.data.showNotification,
          parsed.data.requiresReview,
        ],
      )
      const category = result.rows[0]!
      await audit(request.user.uid, 'category.create', 'category', String(category.id), parsed.data)
      return reply.code(201).send(result.rows[0])
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        return reply.code(409).send({ error: '版块标识已使用' })
      throw error
    }
  })

  app.patch(
    '/api/admin/categories/:id',
    { preHandler: adminPermissions.categories },
    async (request, reply) => {
      const parsed = z
        .object({
          parentId: z.string().regex(/^\d+$/).nullable().optional(),
          name: z.string().trim().min(2).max(64).optional(),
          slug: z
            .string()
            .trim()
            .toLowerCase()
            .regex(/^[a-z0-9-]+$/)
            .max(72)
            .optional(),
          description: z.string().max(500).optional(),
          accentColor: z
            .string()
            .regex(/^#[0-9a-fA-F]{6}$/)
            .optional(),
          iconGlyph: z
            .string()
            .regex(/^[\uE700-\uF8FF]$/u)
            .optional(),
          showNotification: z.boolean().optional(),
          requiresReview: z.boolean().optional(),
          minimumReaderLevel: z.number().int().min(0).optional(),
          minimumAuthorLevel: z.number().int().min(1).optional(),
          sortOrder: z.number().int().optional(),
        })
        .refine((value) => Object.keys(value).length > 0)
        .safeParse(request.body)
      if (!parsed.success) return reply.code(400).send({ error: '版块资料无效' })
      const { id } = request.params as { id: string }
      if (parsed.data.parentId !== undefined && parsed.data.parentId !== null) {
        const cycle = await query<{ cycle: boolean }>(
          `WITH RECURSIVE branch(id) AS (
           SELECT id FROM categories WHERE id = $1
           UNION
           SELECT c.id FROM categories c JOIN branch b ON c.parent_id = b.id
         ) SELECT EXISTS (SELECT 1 FROM branch WHERE id = $2) AS cycle`,
          [id, parsed.data.parentId],
        )
        if (cycle.rows[0]?.cycle) return reply.code(400).send({ error: '版块不能移动到自身或其子版块中' })
      }
      const fieldMap = {
        parentId: 'parent_id',
        name: 'name',
        slug: 'slug',
        description: 'description',
        accentColor: 'accent_color',
        minimumReaderLevel: 'minimum_reader_level',
        minimumAuthorLevel: 'minimum_author_level',
        sortOrder: 'sort_order',
        iconGlyph: 'icon_glyph',
        showNotification: 'show_notification',
        requiresReview: 'requires_review',
      } as const
      const values: unknown[] = []
      const set = Object.entries(fieldMap).flatMap(([key, column]) => {
        const value = parsed.data[key as keyof typeof parsed.data]
        if (value === undefined) return []
        values.push(value)
        return [`${column} = $${values.length}`]
      })
      values.push(id)
      try {
        const result = await query(
          `UPDATE categories SET ${set.join(', ')} WHERE id = $${values.length} RETURNING *`,
          values,
        )
        if (!result.rows[0]) return reply.code(404).send({ error: '版块不存在' })
        await audit(request.user.uid, 'category.update', 'category', id, parsed.data)
        return result.rows[0]
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          return reply.code(409).send({ error: '版块标识已使用' })
        throw error
      }
    },
  )

  app.delete(
    '/api/admin/categories/:id',
    { preHandler: adminPermissions.categories },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const children = await query('SELECT 1 FROM categories WHERE parent_id = $1 LIMIT 1', [id])
      if (children.rowCount) return reply.code(409).send({ error: '请先移动或删除子版块' })
      try {
        const result = await query('DELETE FROM categories WHERE id = $1 RETURNING id', [id])
        if (!result.rowCount) return reply.code(404).send({ error: '版块不存在' })
        await audit(request.user.uid, 'category.delete', 'category', id)
        return { deleted: true }
      } catch (error) {
        if ((error as { code?: string }).code === '23503')
          return reply.code(409).send({ error: '版块仍有帖子，请先移动帖子' })
        throw error
      }
    },
  )

  app.get('/api/admin/level-config', { preHandler: adminPermissions.levels }, async () => {
    const [setting, titles, rules] = await Promise.all([
      query<{ setting_value: number }>(
        "SELECT setting_value::text::integer AS setting_value FROM app_settings WHERE setting_key = 'points_per_level'",
      ),
      query('SELECT id, minimum_level, maximum_level, title, color FROM level_titles ORDER BY minimum_level'),
      query('SELECT action_key, points, is_enabled FROM experience_rules ORDER BY action_key'),
    ])
    return {
      pointsPerLevel: setting.rows[0]?.setting_value ?? 100,
      titles: titles.rows,
      rules: rules.rows,
    }
  })

  app.put('/api/admin/level-config', { preHandler: adminPermissions.levels }, async (request, reply) => {
    const parsed = z
      .object({
        pointsPerLevel: z.number().int().min(1).max(100000),
        titles: z
          .array(
            z.object({
              minimumLevel: z.number().int().min(1),
              maximumLevel: z.number().int().min(1),
              title: z.string().trim().min(1).max(48),
              color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
            }),
          )
          .max(100),
        rules: z.array(
          z.object({
            actionKey: z.enum(['checkin', 'create_post', 'create_reply']),
            points: z.number().int().min(0).max(100000),
            isEnabled: z.boolean(),
          }),
        ),
      })
      .safeParse(request.body)
    if (!parsed.success || parsed.data.titles.some((title) => title.maximumLevel < title.minimumLevel)) {
      return reply.code(400).send({ error: '等级配置无效' })
    }
    const ranges = [...parsed.data.titles].sort((a, b) => a.minimumLevel - b.minimumLevel)
    for (let index = 1; index < ranges.length; index += 1) {
      const previous = ranges[index - 1]!
      const current = ranges[index]!
      if (current.minimumLevel <= previous.maximumLevel)
        return reply.code(400).send({ error: '头衔等级范围不能重叠' })
    }
    await inTransaction(async (client) => {
      await client.query(
        "UPDATE app_settings SET setting_value = $1::jsonb WHERE setting_key = 'points_per_level'",
        [JSON.stringify(parsed.data.pointsPerLevel)],
      )
      await client.query('DELETE FROM level_titles')
      for (const title of parsed.data.titles) {
        await client.query(
          'INSERT INTO level_titles (minimum_level, maximum_level, title, color) VALUES ($1, $2, $3, $4)',
          [title.minimumLevel, title.maximumLevel, title.title, title.color],
        )
      }
      for (const rule of parsed.data.rules) {
        await client.query(
          `INSERT INTO experience_rules (action_key, points, is_enabled) VALUES ($1, $2, $3)
           ON CONFLICT (action_key) DO UPDATE SET points = EXCLUDED.points, is_enabled = EXCLUDED.is_enabled`,
          [rule.actionKey, rule.points, rule.isEnabled],
        )
      }
    })
    await audit(request.user.uid, 'levels.update', 'level-config', null, parsed.data)
    return { saved: true }
  })

  app.get('/api/admin/posts', { preHandler: adminPermissions.posts }, async (request) => {
    const parsed = z
      .object({
        status: z.enum(['published', 'pending', 'hidden', 'rejected']).optional(),
      })
      .safeParse(request.query)
    const status = parsed.success ? (parsed.data.status ?? null) : null
    const result = await query(
      `SELECT p.id, p.title, p.status, p.is_pinned, p.minimum_reader_level, p.created_at,
              c.name AS category_name, u.uid AS author_uid, u.display_name,
              (SELECT COUNT(*) FROM replies r WHERE r.post_id = p.id)::int AS reply_count
       FROM posts p JOIN categories c ON c.id = p.category_id JOIN users u ON u.uid = p.author_uid
       WHERE p.deleted_at IS NULL AND ($1::text IS NULL OR p.status = $1) ORDER BY p.created_at DESC LIMIT 200`,
      [status],
    )
    return result.rows
  })

  app.patch('/api/admin/posts/:id', { preHandler: adminPermissions.posts }, async (request, reply) => {
    const parsed = z
      .object({
        status: z.enum(['published', 'pending', 'hidden']).optional(),
        isPinned: z.boolean().optional(),
      })
      .refine((value) => Object.keys(value).length > 0)
      .safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: '帖子状态无效' })
    const { id } = request.params as { id: string }
    const values: unknown[] = []
    const set: string[] = []
    if (parsed.data.status) {
      values.push(parsed.data.status)
      set.push(`status = $${values.length}`)
    }
    if (parsed.data.isPinned !== undefined) {
      values.push(parsed.data.isPinned)
      set.push(`is_pinned = $${values.length}`)
    }
    values.push(id)
    const result = await query(
      `UPDATE posts SET ${set.join(', ')}, updated_at = NOW() WHERE id = $${values.length} AND deleted_at IS NULL
      ${parsed.data.status ? "AND status IN ('published', 'hidden')" : ''} RETURNING id, status, is_pinned`,
      values,
    )
    if (!result.rows[0]) {
      const exists = await query('SELECT 1 FROM posts WHERE id = $1 AND deleted_at IS NULL', [id])
      return exists.rowCount
        ? reply.code(409).send({ error: '请在发帖审核中处理此帖' })
        : reply.code(404).send({ error: '帖子不存在' })
    }
    await audit(request.user.uid, 'post.moderate', 'post', id, parsed.data)
    return result.rows[0]
  })

  app.delete('/api/admin/posts/:id', { preHandler: adminPermissions.posts }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = await inTransaction(async (client) => {
      const updated = await client.query(
        `UPDATE posts SET deleted_at = NOW(), deletion_source = 'admin', deleted_by = $2, purge_after = NULL, updated_at = NOW()
         WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
        [id, request.user.uid],
      )
      if (!updated.rows[0]) return null
      await client.query(
        "INSERT INTO audit_events (actor_uid, action_key, target_type, target_id) VALUES ($1, 'post.delete', 'post', $2)",
        [request.user.uid, id],
      )
      return updated.rows[0]
    })
    if (!result) return reply.code(404).send({ error: '帖子不存在或已删除' })
    return result
  })
  app.get(
    '/api/admin/deleted-posts',
    { preHandler: adminPermissions.posts },
    async () =>
      (
        await query(
          `SELECT p.id, p.title, p.status, p.deleted_at, p.created_at, c.name AS category_name,
              u.uid AS author_uid, u.display_name, d.display_name AS deleted_by_name
       FROM posts p JOIN users u ON u.uid = p.author_uid JOIN categories c ON c.id = p.category_id
       LEFT JOIN users d ON d.uid = p.deleted_by
       WHERE p.deleted_at IS NOT NULL AND p.deletion_source = 'admin' ORDER BY p.deleted_at DESC LIMIT 200`,
        )
      ).rows,
  )
  app.post(
    '/api/admin/deleted-posts/:id/restore',
    { preHandler: adminPermissions.posts },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const result = await inTransaction(async (client) => {
        const updated = await client.query(
          `UPDATE posts SET deleted_at = NULL, deleted_by = NULL, purge_after = NULL, updated_at = NOW()
         WHERE id = $1 AND deleted_at IS NOT NULL AND deletion_source = 'admin' RETURNING id, status`,
          [id],
        )
        if (!updated.rows[0]) return null
        await client.query(
          "INSERT INTO audit_events (actor_uid, action_key, target_type, target_id) VALUES ($1, 'post.restore', 'post', $2)",
          [request.user.uid, id],
        )
        return updated.rows[0]
      })
      if (!result) return reply.code(404).send({ error: '删除记录不存在' })
      return result
    },
  )

  app.get('/api/admin/settings', { preHandler: adminPermissions.settings }, async () => {
    return readSettings([
      'site_title',
      'site_icon_url',
      'site_url',
      'registration_enabled',
      'registration_mode',
      'trash_retention_days',
    ])
  })

  app.patch('/api/admin/settings', { preHandler: adminPermissions.settings }, async (request, reply) => {
    const parsed = z
      .object({
        siteTitle: z.string().trim().min(1).max(64).optional(),
        siteUrl: z.union([httpUrl, z.literal('')]).optional(),
        registrationEnabled: z.boolean().optional(),
        registrationMode: z.enum(['invite', 'open']).optional(),
        trashRetentionDays: z.number().int().min(1).max(3650).optional(),
      })
      .refine((value) => Object.keys(value).length > 0)
      .safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: '请检查站点名称、URL 和注册设置' })
    const map = {
      siteTitle: 'site_title',
      siteUrl: 'site_url',
      registrationEnabled: 'registration_enabled',
      registrationMode: 'registration_mode',
      trashRetentionDays: 'trash_retention_days',
    }
    await inTransaction((client) =>
      saveSettings(
        Object.fromEntries(
          Object.entries(parsed.data).map(([key, value]) => [map[key as keyof typeof map], value]),
        ),
        client,
      ),
    )
    await audit(request.user.uid, 'site.settings.update', 'site', null, parsed.data)
    return { saved: true }
  })

  app.get('/api/admin/audit', { preHandler: adminPermissions.settings }, async () => {
    const result = await query(
      `SELECT a.id, a.action_key, a.target_type, a.target_id, a.details, a.created_at,
              u.display_name AS actor_name
       FROM audit_events a LEFT JOIN users u ON u.uid = a.actor_uid
       ORDER BY a.created_at DESC LIMIT 100`,
    )
    return result.rows
  })
}
