import { createWriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'

export async function withStagingDirectory<T>(work: (directory: string) => Promise<T>) {
  const directory = await mkdtemp(join(tmpdir(), 'forum-media-'))
  try {
    return await work(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

export async function stageFile(
  source: AsyncIterable<Uint8Array>,
  path: string,
  maximumBytes: number,
  message: string,
) {
  let bytes = 0
  await pipeline(
    source,
    async function* (chunks) {
      for await (const chunk of chunks) {
        bytes += chunk.byteLength
        if (bytes > maximumBytes) throw Object.assign(new Error(message), { statusCode: 413 })
        yield chunk
      }
    },
    createWriteStream(path),
  )
  return bytes
}
