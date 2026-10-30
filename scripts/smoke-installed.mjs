import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
const origin = 'http://127.0.0.1:4000'
async function api(path, options = {}) {
  const response = await fetch(origin + path, {
    ...options,
    headers: { 'content-type': 'application/json', ...options.headers },
  })
  assert.ok(response.ok, `HTTP ${response.status}: ${path}`)
  return response.json()
}
const owner = await api('/api/setup/initialize', {
  method: 'POST',
  body: JSON.stringify({
    username: 'installer_test',
    displayName: 'Installer test',
    email: 'installer@example.test',
    password: randomUUID(),
  }),
})
const headers = { authorization: `Bearer ${owner.token}` }
let status = await api('/api/admin/updates', { headers })
assert.equal(status.managed, true)
assert.equal(status.settings.automatic, false)
assert.equal((await fetch(origin)).status, 200)
await api('/api/admin/updates', {
  method: 'PATCH',
  headers,
  body: JSON.stringify({ automatic: true, channel: 'releases' }),
})
const queued = await api('/api/admin/updates/install', {
  method: 'POST',
  headers,
})
for (let attempt = 0; attempt < 60; attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 1000))
  status = await api('/api/admin/updates', { headers })
  if (status.job?.id !== queued.id) continue
  if (status.job.state === 'failed') throw new Error(status.job.message)
  if (status.job.state === 'current') {
    console.log(
      'systemd installation passed: production site, database, managed update settings and root update service request/result',
    )
    process.exit(0)
  }
}
throw new Error('systemd update service did not complete the request')
