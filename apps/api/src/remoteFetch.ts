import { lookup } from 'node:dns/promises'
import { Agent, buildConnector, fetch } from 'undici'
import ipaddr from 'ipaddr.js'

const remoteError = (message: string) => Object.assign(new Error(message), { statusCode: 502 })
export function isPublicAddress(address: string) {
  return ipaddr.isValid(address) && ipaddr.process(address).range() === 'unicast'
}

// Resolve and pin the checked address at connection time, not before a second DNS lookup.
const connect = buildConnector({})
const publicDispatcher = new Agent({
  connect(options, callback) {
    const hostname = options.hostname.replace(/^\[|\]$/g, '')
    void lookup(hostname, { all: true }).then((addresses) => {
      if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address)))
        throw remoteError('远端图片不可访问私有或保留网络地址')
      connect({ ...options, hostname: addresses[0]!.address, servername: options.servername || hostname }, callback)
    }).catch((error: Error) => callback(error, null))
  },
})

export async function fetchRemoteResource(
  value: string,
  trustedOrigin: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
) {
  const deadline = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
    : AbortSignal.timeout(30000)
  let url = new URL(value)
  for (let redirect = 0; redirect <= 5; redirect++) {
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      throw remoteError('远端地址无效')
    // Only the exact API origin configured by the administrator may use a private network.
    const trusted = url.origin === trustedOrigin
    const host = url.hostname.replace(/^\[|\]$/g, '')
    if (!trusted && ipaddr.isValid(host) && !isPublicAddress(host))
      throw remoteError('远端图片不可访问私有或保留网络地址')
    const response = await fetch(url, {
      headers, signal: deadline, redirect: 'manual',
      ...(trusted ? {} : { dispatcher: publicDispatcher }),
    })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel()
      const location = response.headers.get('location')
      if (!location || redirect === 5) throw remoteError('远端重定向次数过多或地址无效')
      url = new URL(location, url)
      continue
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw remoteError(`远端请求失败 (${response.status})`)
    }
    return response
  }
  throw remoteError('远端重定向次数过多')
}

export async function readRemoteJson(response: Awaited<ReturnType<typeof fetchRemoteResource>>) {
  const chunks: Uint8Array[] = []
  let bytes = 0
  for await (const chunk of response.body!) {
    bytes += chunk.byteLength
    if (bytes > 4 * 1024 ** 2) throw remoteError('远端表情数据超过 4 MiB')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}
