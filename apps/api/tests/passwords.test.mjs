import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import bcrypt from 'bcryptjs'
import passwords, { closePasswordWorkers } from '../src/passwords.ts'

after(closePasswordWorkers)
test('password workers accept existing bcrypt prefixes, costs and long Unicode passwords', async () => {
  for (const password of ['Existing account password', '多字节密码'.repeat(20)]) {
    const old = bcrypt.hashSync(password, 4)
    for (const prefix of ['2a', '2b', '2y'])
      assert.equal(await passwords.compare(password, old.replace('$2b$', `$${prefix}$`)), true)
    assert.equal(await passwords.compare('wrong password', old), false)
    const created = await passwords.hash(password, 5)
    assert.ok(created.startsWith('$forum-sha256$v1$'))
    assert.equal(bcrypt.getRounds(created.slice('$forum-sha256$v1$'.length)), 5)
    assert.equal(await passwords.compare(password, created), true)
  }
  assert.equal(await passwords.compare('password', 'invalid'), false)
})

test('new passwords include every byte beyond the bcrypt 72-byte boundary', async () => {
  for (const prefix of ['a'.repeat(72), '多'.repeat(24)]) {
    const hash = await passwords.hash(prefix + 'first', 4)
    assert.equal(await passwords.compare(prefix + 'first', hash), true)
    assert.equal(await passwords.compare(prefix + 'second', hash), false)
    assert.equal(await passwords.compare(prefix, hash), false)
  }
})

test('a full worker queue rejects excess work and recovers after queued jobs finish', async () => {
  const tasks = Array.from({ length: 80 }, () => passwords.hash('queue regression', 4))
  const results = await Promise.allSettled(tasks)
  assert.ok(results.some((r) => r.status === 'fulfilled'))
  const rejected = results.filter((r) => r.status === 'rejected')
  assert.ok(rejected.length > 0)
  assert.ok(rejected.every((r) => r.reason.statusCode === 503))
  const hash = await passwords.hash('recovered password', 4)
  assert.equal(await passwords.compare('recovered password', hash), true)
})
