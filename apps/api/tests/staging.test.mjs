import assert from 'node:assert/strict'
import { test } from 'node:test'
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { withStagingDirectory, stageFile } from '../src/staging.ts'

test('staged uploads preserve bytes and remove the temporary directory after use', async () => {
  let directory
  await withStagingDirectory(async (path) => {
    directory = path
    const file = join(path, 'upload')
    const bytes = await stageFile(
      (async function* () {
        yield Buffer.from('first')
        yield Buffer.from('second')
      })(),
      file,
      100,
      'limit',
    )
    assert.equal(bytes, 11)
    assert.equal(await readFile(file, 'utf8'), 'firstsecond')
  })
  await assert.rejects(access(directory), { code: 'ENOENT' })
})

test('oversized streams stop early and cleanup runs on errors', async () => {
  let directory,
    produced = 0
  await assert.rejects(
    withStagingDirectory(async (path) => {
      directory = path
      await stageFile(
        (async function* () {
          for (let i = 0; i < 100; i++) {
            produced++
            yield Buffer.alloc(1024)
          }
        })(),
        join(path, 'upload'),
        2048,
        'too large',
      )
    }),
    { message: 'too large', statusCode: 413 },
  )
  assert.ok(produced < 100)
  await assert.rejects(access(directory), { code: 'ENOENT' })
})
