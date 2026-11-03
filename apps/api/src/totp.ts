import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function encodeBase32(value: Buffer) {
  let bits = 0
  let accumulator = 0
  let encoded = ''
  for (const byte of value) {
    accumulator = (accumulator << 8) | byte
    bits += 8
    while (bits >= 5) {
      encoded += alphabet[(accumulator >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits) encoded += alphabet[(accumulator << (5 - bits)) & 31]
  return encoded
}

function decodeBase32(value: string) {
  let bits = 0
  let accumulator = 0
  const bytes: number[] = []
  for (const character of value.toUpperCase().replace(/=+$/, '')) {
    const digit = alphabet.indexOf(character)
    if (digit < 0) throw new Error('Invalid Base32 secret')
    accumulator = (accumulator << 5) | digit
    bits += 5
    if (bits >= 8) {
      bytes.push((accumulator >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

export function generateTotpSecret() {
  return encodeBase32(randomBytes(20))
}

export function provisioningUri(secret: string, account: string, issuer: string) {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`
  const query = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  })
  return `otpauth://totp/${label}?${query}`
}

export function totpCode(secret: string, at = Date.now()) {
  const counter = BigInt(Math.floor(at / 30_000))
  const message = Buffer.alloc(8)
  message.writeBigUInt64BE(counter)
  const digest = createHmac('sha1', decodeBase32(secret)).update(message).digest()
  const offset = digest[digest.length - 1]! & 15
  const binary =
    ((digest[offset]! & 127) << 24) |
    ((digest[offset + 1]! & 255) << 16) |
    ((digest[offset + 2]! & 255) << 8) |
    (digest[offset + 3]! & 255)
  return String(binary % 1_000_000).padStart(6, '0')
}

export function matchingTotpCounter(secret: string, code: string, at = Date.now(), afterCounter = -1n) {
  if (!/^\d{6}$/.test(code)) return null
  const currentCounter = BigInt(Math.floor(at / 30_000))
  const supplied = Buffer.from(code)
  for (const counter of [currentCounter - 1n, currentCounter, currentCounter + 1n]) {
    if (counter <= afterCounter || counter < 0n) continue
    const expected = Buffer.from(totpCode(secret, Number(counter) * 30_000))
    if (timingSafeEqual(supplied, expected)) return counter
  }
  return null
}
