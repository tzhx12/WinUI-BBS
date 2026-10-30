import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { test } from 'node:test'
import { isWindows } from '../src/iconPlatform.ts'

const root = new URL('../', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('icons/fluent-system-icons.json', root), 'utf8'))

test('OS routing uses client hints, then platform, then user agent', () => {
  for (const platform of ['Windows', 'Win32', 'Win64', 'WinARM']) {
    assert.equal(isWindows({ platform, userAgent: '' }), true, platform)
  }
  for (const platform of ['MacIntel', 'Linux x86_64', 'Linux armv8l', 'iPhone', 'iPad']) {
    assert.equal(isWindows({ platform, userAgent: '' }), false, platform)
  }
  assert.equal(isWindows({ platform: '', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }), true)
  assert.equal(isWindows({ platform: '', userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' }), false)
  assert.equal(isWindows({ platform: '', userAgent: '' }), false)
  assert.equal(
    isWindows({ userAgentData: { platform: 'Android' }, platform: 'Win32', userAgent: 'Windows' }),
    false,
  )
  assert.equal(isWindows({ userAgentData: { platform: 'Windows' }, platform: '', userAgent: '' }), true)
  assert.equal(isWindows({ userAgentData: { platform: '' }, platform: 'Win32', userAgent: '' }), true)
})

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory)
    return entry.isDirectory() ? sourceFiles(path) : /\.(vue|ts|css)$/.test(entry.name) ? [path] : []
  })
}

test('every application and WinUI internal literal glyph has a Fluent counterpart', () => {
  const files = [
    ...sourceFiles(new URL('src/', root)),
    new URL('../../node_modules/winuionweb/dist-lib/index.js', root),
  ]
  const glyphPattern =
    /[\ue000-\uf8ff]|\\u([eEfF][\da-fA-F]{3})|0x([eEfF][\da-fA-F]{3})|&#x([eEfF][\da-fA-F]{3});/g
  for (const file of files) {
    for (const match of readFileSync(file, 'utf8').matchAll(glyphPattern)) {
      const code = (match[1] || match[2] || match[3] || match[0].codePointAt(0).toString(16)).toLowerCase()
      assert.ok(manifest.glyphs[code], `${file.pathname}: U+${code.toUpperCase()} needs a Fluent mapping`)
    }
  }
})

test('the pinned Fluent package provides every mapped SVG', () => {
  const packageRoot = new URL('../../node_modules/@fluentui/svg-icons/', root)
  const metadata = JSON.parse(readFileSync(new URL('package.json', packageRoot), 'utf8'))
  assert.equal(metadata.version, manifest.version)
  for (const asset of new Set(Object.values(manifest.glyphs))) {
    assert.match(readFileSync(new URL(`icons/${asset}.svg`, packageRoot), 'utf8'), /<svg\b/)
  }
})

test('the shipped WOFF contains all mapped codepoints and their selected Fluent outlines', () => {
  const woff = readFileSync(new URL('src/assets/fluent-system-icons.woff', root))
  assert.equal(woff.toString('ascii', 0, 4), 'wOFF')
  function table(tag) {
    for (let entry = 44; entry < 44 + woff.readUInt16BE(12) * 20; entry += 20) {
      if (woff.toString('ascii', entry, entry + 4) !== tag) continue
      const offset = woff.readUInt32BE(entry + 4)
      const size = woff.readUInt32BE(entry + 8)
      const data = woff.subarray(offset, offset + size)
      return size < woff.readUInt32BE(entry + 12) ? inflateSync(data) : data
    }
    throw new Error(`Missing WOFF table: ${tag}`)
  }
  const cmap = table('cmap')
  const post = table('post')
  assert.equal(post.readUInt32BE(0), 0x00020000)
  const glyphCount = post.readUInt16BE(32)
  const customNames = []
  for (let offset = 34 + glyphCount * 2; offset < post.length;) {
    const size = post[offset++]
    customNames.push(post.toString('ascii', offset, offset + size))
    offset += size
  }
  let format4
  for (let entry = 4; entry < 4 + cmap.readUInt16BE(2) * 8; entry += 8) {
    const offset = cmap.readUInt32BE(entry + 4)
    if (cmap.readUInt16BE(offset) === 4) format4 = cmap.subarray(offset)
  }
  assert.ok(format4, 'Unicode BMP cmap is required')
  const count = format4.readUInt16BE(6) / 2
  const end = 14
  const start = end + count * 2 + 2
  const delta = start + count * 2
  const range = delta + count * 2
  for (const [code, asset] of Object.entries(manifest.glyphs)) {
    const point = parseInt(code, 16)
    let glyph = 0
    for (let segment = 0; segment < count; segment++) {
      if (
        point < format4.readUInt16BE(start + segment * 2) ||
        point > format4.readUInt16BE(end + segment * 2)
      )
        continue
      const adjustment = format4.readInt16BE(delta + segment * 2)
      const position = range + segment * 2
      const offset = format4.readUInt16BE(position)
      glyph = offset
        ? format4.readUInt16BE(position + offset + (point - format4.readUInt16BE(start + segment * 2)) * 2)
        : point
      if (glyph) glyph = (glyph + adjustment) & 0xffff
      break
    }
    assert.ok(glyph > 0, `U+${code.toUpperCase()} is missing; rebuild the font`)
    const nameIndex = post.readUInt16BE(34 + glyph * 2)
    assert.equal(
      customNames[nameIndex - 258],
      asset,
      `U+${code.toUpperCase()} must use ${asset}; rebuild the font`,
    )
  }
})
