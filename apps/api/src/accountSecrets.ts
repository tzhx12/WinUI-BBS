import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto'

function encryptionKey() {
  const key = Buffer.from(process.env.MAIL_ENCRYPTION_KEY || '', 'base64')
  if (key.length !== 32)
    throw Object.assign(new Error('请先在服务端配置 32 字节 Base64 格式的 MAIL_ENCRYPTION_KEY'), {
      statusCode: 503,
    })
  return key
}

export function encryptSecret(secret: string) {
  if (!secret) return ''
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), ciphertext].map((value) => value.toString('base64')).join('.')
}

export function decryptSecret(secret: string) {
  if (!secret) return ''
  const [iv, tag, ciphertext] = secret.split('.').map((value) => Buffer.from(value, 'base64'))
  const cipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv!)
  cipher.setAuthTag(tag!)
  return Buffer.concat([cipher.update(ciphertext!), cipher.final()]).toString('utf8')
}

export function secretHash(secret: string) {
  return createHmac('sha256', encryptionKey()).update(secret).digest('hex')
}
