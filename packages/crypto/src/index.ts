import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16

function resolveEncryptionKey(): Buffer {
  const raw = process.env.CREDENTIALS_ENCRYPTION_KEY?.trim()
  if (!raw) {
    throw new Error('CREDENTIALS_ENCRYPTION_KEY is not configured')
  }

  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) {
    throw new Error('CREDENTIALS_ENCRYPTION_KEY must decode to 32 bytes (base64)')
  }

  return key
}

export function encryptSecret(plaintext: string): string {
  const key = resolveEncryptionKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return Buffer.concat([iv, authTag, encrypted]).toString('base64')
}

export function decryptSecret(ciphertext: string): string {
  const key = resolveEncryptionKey()
  const payload = Buffer.from(ciphertext, 'base64')

  if (payload.length <= IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error('Invalid encrypted payload')
  }

  const iv = payload.subarray(0, IV_LENGTH)
  const authTag = payload.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
  const encrypted = payload.subarray(IV_LENGTH + AUTH_TAG_LENGTH)

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}

export function hasEncryptionKey(): boolean {
  return Boolean(process.env.CREDENTIALS_ENCRYPTION_KEY?.trim())
}
