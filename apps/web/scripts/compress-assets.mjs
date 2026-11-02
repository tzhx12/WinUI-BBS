import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { brotliCompress, gzip } from 'node:zlib'

const brotli = promisify(brotliCompress),
  zip = promisify(gzip)
const root = fileURLToPath(new URL('../dist/', import.meta.url))
async function compress(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await compress(path)
    else if (/\.(js|css|html|svg|json)$/.test(entry.name)) {
      const source = await readFile(path)
      if (source.length < 1024) continue
      const results = await Promise.all([brotli(source), zip(source, { level: 9 })])
      for (const [index, extension] of ['br', 'gz'].entries())
        if (results[index].length < source.length) await writeFile(`${path}.${extension}`, results[index])
    }
  }
}
await compress(root)
