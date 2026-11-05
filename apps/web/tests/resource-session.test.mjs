import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRenderer, h, nextTick } from 'vue'
import { createSite, siteKey } from '../src/site.ts'
import { useResource } from '../src/composables/useResource.ts'

const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const renderer = createRenderer({
  createElement: () => ({}),
  createText: () => ({}),
  createComment: () => ({}),
  insert() {},
  remove() {},
  setText() {},
  setElementText() {},
  patchProp() {},
  parentNode: () => null,
  nextSibling: () => null,
})

test('overlapping resource loads retain only the latest data, error and loading state', async () => {
  const requests = []
  let resource
  const app = renderer.createApp({
    setup() {
      resource = useResource(() => {
        const request = deferred()
        requests.push(request)
        return request.promise
      }, 'initial')
      return () => h('div')
    },
  })
  app.provide(siteKey, { notify() {} })
  app.mount({})
  const newest = resource.reload()
  requests[0].resolve('old')
  await nextTick()
  assert.equal(resource.data.value, 'initial')
  assert.equal(resource.loading.value, true)
  requests[1].resolve('current')
  await newest
  assert.equal(resource.data.value, 'current')
  assert.equal(resource.loading.value, false)
  const staleFailure = resource.reload()
  const next = resource.reload()
  requests[3].resolve('newer')
  await next
  requests[2].reject(new Error('stale failure'))
  await staleFailure
  assert.equal(resource.data.value, 'newer')
  assert.equal(resource.error.value, '')
  const unmounted = resource.reload()
  app.unmount()
  requests[4].resolve('after unmount')
  await unmounted
  assert.equal(resource.data.value, 'newer')
})

function browserEnvironment(t) {
  const original = {
    fetch: globalThis.fetch,
    document: globalThis.document,
    localStorage: globalThis.localStorage,
  }
  const values = new Map()
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
  globalThis.document = {
    documentElement: { classList: { toggle() {} }, dataset: {}, style: { setProperty() {} } },
    querySelector: () => ({}),
  }
  t.after(() => {
    Object.assign(globalThis, original)
  })
}

test('session refresh ignores responses from a previous login and does not sign out a replacement session', async (t) => {
  browserEnvironment(t)
  const requests = []
  globalThis.fetch = () => {
    const request = deferred()
    requests.push(request)
    return request.promise
  }
  const site = createSite()
  site.token.value = 'first'
  const old = site.refreshUser(false)
  site.token.value = 'second'
  const current = site.refreshUser(false)
  requests[1].resolve(Response.json({ uid: '2', permissions: ['media.manage'] }))
  await current
  requests[0].resolve(Response.json({ error: 'expired' }, { status: 401 }))
  await old
  assert.equal(site.token.value, 'second')
  assert.equal(site.user.value.uid, '2')
  const pending = site.refreshUser(false)
  site.signOut(false)
  requests[2].resolve(Response.json({ uid: '2', permissions: ['media.manage'] }))
  await pending
  assert.equal(site.user.value, null)
})

test('expired stored sessions load public categories after becoming a guest', async (t) => {
  browserEnvironment(t)
  localStorage.setItem('forum-token', 'expired')
  let categoriesAuthorization
  globalThis.fetch = async (path, options) => {
    if (path === '/api/auth/me') return Response.json({ error: 'expired' }, { status: 401 })
    if (path === '/api/categories') {
      categoriesAuthorization = new Headers(options.headers).get('Authorization')
      return Response.json([])
    }
    if (path === '/api/site') return Response.json({ site_title: '测试社区', site_icon_url: '' })
    throw new Error(`Unexpected path ${path}`)
  }
  const site = createSite()
  await site.load()
  assert.equal(site.token.value, null)
  assert.equal(site.user.value, null)
  assert.equal(categoriesAuthorization, null)
  assert.deepEqual(site.categories.value, [])
})
