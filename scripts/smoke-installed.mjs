import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
const origin = 'http://127.0.0.1:4000'
async function api(path, options = {}) {
  const response = await fetch(origin + path, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    },
  })
  assert.ok(response.ok, `HTTP ${response.status}: ${path}`)
  return response.json()
}
const installationLog = execFileSync('sudo', ['journalctl', '-u', 'winui-bbs', '--no-pager', '-o', 'cat'], {
  encoding: 'utf8',
})
const entry = installationLog
  .split('\n')
  .flatMap((line) => {
    try {
      return [JSON.parse(line)]
    } catch {
      return []
    }
  })
  .findLast((entry) => entry.setupPath)
assert.ok(entry?.setupPath, 'installation log must contain the private setup entry')
const owner = await api('/api/setup/initialize', {
  headers: { 'x-setup-token': entry.setupPath.split('/').at(-1) },
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
