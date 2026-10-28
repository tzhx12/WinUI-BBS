import { randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { inTransaction, query } from '../db.js'

const setupSchema = z.object({
  username: z.string().trim().min(3).max(32).regex(/^[a-zA-Z0-9_.-]+$/),
  email: z.email(),
  displayName: z.string().trim().min(1).max(48),
  password: z.string().min(10).max(128),
})

export async function registerSetupRoutes(app: FastifyInstance) {
  app.get('/api/setup/status', async () => {
    const result = await query<{ count: string }>('SELECT COUNT(*)::text AS count FROM users')
    return { required: Number(result.rows[0]?.count ?? 0) === 0 }
  })

  app.post('/api/setup/initialize', async (request, reply) => {
    const parsed = setupSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: '请完整填写管理员账号，密码至少 10 位' })
    const passwordHash = await bcrypt.hash(parsed.data.password, 12)
    const result = await inTransaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('forum-first-admin'))")
      const existing = await client.query('SELECT 1 FROM users LIMIT 1')
      if (existing.rowCount) return null
      const created = await client.query<{ uid: string; uuid: string; username: string; display_name: string }>(
        `INSERT INTO users (username, email, password_hash, display_name)
         VALUES ($1, $2, $3, $4) RETURNING uid, uuid, username, display_name`,
        [parsed.data.username.toLowerCase(), parsed.data.email.toLowerCase(), passwordHash, parsed.data.displayName],
      )
      const owner = created.rows[0]!
      const groups = await client.query<{ id: string; name: string }>(
        "SELECT id, name FROM user_groups WHERE name = '站点管理' OR is_default = TRUE",
      )
      for (const group of groups.rows) {
        await client.query('INSERT INTO group_memberships (user_uid, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [owner.uid, group.id])
      }
      const categories = await client.query<{ id: string; slug: string }>('SELECT id, slug FROM categories')
      const bySlug = new Map(categories.rows.map((category) => [category.slug, category.id]))
      const examples = [
        ['把社区首页做成一个安静的广场', 'square', '我们希望这里更像一张正在展开的桌子：有新话题，也有值得慢慢读完的讨论。'],
        ['你最近在用什么小工具改善工作流？', 'technology', '分享一个最近真正帮到你的工具或习惯，也说说它解决了什么麻烦。'],
        ['欢迎来到 WinUI-BBS', 'ideas', '发帖支持图文、引用、列表与剧透标记。签到和参与讨论都能积累经验。'],
        ['如何给新话题找到合适版块？', 'questions', '版块可以由管理员拖拽成树形结构；访问等级和发帖等级分别设置。'],
      ] as const
      for (const [title, slug, text] of examples) {
        const categoryId = bySlug.get(slug)
        if (!categoryId) continue
        await client.query(
          'INSERT INTO posts (category_id, author_uid, title, body) VALUES ($1, $2, $3, $4::jsonb)',
          [categoryId, owner.uid, title, JSON.stringify({ time: Date.now(), blocks: [{ id: randomUUID(), type: 'paragraph', data: { text } }], version: '2.31.0' })],
        )
      }
      return owner
    })
    if (!result) return reply.code(409).send({ error: '管理员已经创建，请登录' })
    const token = app.jwt.sign({ uid: result.uid, uuid: result.uuid }, { expiresIn: '7d' })
    return reply.code(201).send({ token, user: { uid: result.uid, uuid: result.uuid, username: result.username, displayName: result.display_name, level: 1, experience: 0 } })
  })
}
