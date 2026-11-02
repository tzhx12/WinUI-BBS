import { relative, resolve } from 'node:path'
import type { FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'

export async function registerWebAssets(app: FastifyInstance, directory: string) {
  const root = resolve(directory)
  await app.register(fastifyStatic, {
    root,
    prefix: '/',
    decorateReply: false,
    preCompressed: true,
    cacheControl: false,
    setHeaders(response, file) {
      const path = relative(root, file)
        .replaceAll('\\', '/')
        .replace(/\.(br|gz)$/, '')
      const hashed = /^assets\/.+-[\w-]{8,}\.[\w.]+$/.test(path)
      response.header('Cache-Control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache')
    },
  })
}
