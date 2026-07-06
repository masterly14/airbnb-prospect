import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"

export type OAuthStatePayload = {
  accountId: string
  connectionRequestId?: string
  nonce: string
  exp: number
}

const STATE_TTL_MS = 15 * 60 * 1000

function resolveOAuthSecret(): string {
  const secret = process.env.COMPOSIO_OAUTH_STATE_SECRET?.trim() ?? process.env.CREDENTIALS_ENCRYPTION_KEY?.trim()
  if (!secret) {
    throw new Error("COMPOSIO_OAUTH_STATE_SECRET or CREDENTIALS_ENCRYPTION_KEY is required for OAuth state")
  }
  return secret
}

function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url")
}

export function createOAuthState(input: {
  accountId: string
  connectionRequestId?: string
}): string {
  const payload: OAuthStatePayload = {
    accountId: input.accountId,
    connectionRequestId: input.connectionRequestId,
    nonce: randomBytes(16).toString("hex"),
    exp: Date.now() + STATE_TTL_MS,
  }

  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url")
  const signature = signPayload(encoded, resolveOAuthSecret())
  return `${encoded}.${signature}`
}

export function verifyOAuthState(state: string): OAuthStatePayload | null {
  const [encoded, signature] = state.split(".")
  if (!encoded || !signature) return null

  const secret = resolveOAuthSecret()
  const expected = signPayload(encoded, secret)

  const sigBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expected)
  if (sigBuffer.length !== expectedBuffer.length) return null
  if (!timingSafeEqual(sigBuffer, expectedBuffer)) return null

  let payload: OAuthStatePayload
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as OAuthStatePayload
  } catch {
    return null
  }

  if (!payload.accountId || !payload.nonce || !payload.exp) return null
  if (Date.now() > payload.exp) return null

  return payload
}
