import { open } from 'node:fs/promises'

export function validateImageSignature(buffer: Buffer, mime: string) {
  const matches = mime === 'image/png'
    ? buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : mime === 'image/jpeg'
      ? buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255
      : mime === 'image/gif'
        ? ['GIF87a', 'GIF89a'].includes(buffer.toString('ascii', 0, 6))
        : mime === 'image/webp' && buffer.toString('ascii', 0, 4) === 'RIFF' &&
          buffer.toString('ascii', 8, 12) === 'WEBP'
  if (!matches) throw Object.assign(new Error('图片内容与格式不符'), { statusCode: 415 })
}

export async function validateStagedImage(path: string, mime: string) {
  const file = await open(path, 'r')
  try {
    const { buffer, bytesRead } = await file.read(Buffer.alloc(12), 0, 12, 0)
    validateImageSignature(buffer.subarray(0, bytesRead), mime)
  } finally {
    await file.close()
  }
}
