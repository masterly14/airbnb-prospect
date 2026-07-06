import { Composio } from "@composio/core"
import {
  buildOtpConfigFromAccount,
  getGmailToolkitVersion,
  type ComposioConfig,
} from "@repo/composio"

export type { ComposioConfig } from "@repo/composio"

export type GmailMessage = {
  messageId?: string
  subject?: string
  internalDate?: number | string
  body?: string
  snippet?: string
}

const AIRBNB_SENDER = "automated@airbnb.com"
const GMAIL_QUERY = `from:${AIRBNB_SENDER} subject:(código OR code) newer_than:1d`

export { getGmailToolkitVersion, buildOtpConfigFromAccount }

export function getComposioConfigFromEnv(): ComposioConfig {
  const apiKey = process.env.COMPOSIO_API_KEY
  const userId = process.env.COMPOSIO_USER_ID
  const connectionId = process.env.COMPOSIO_CONNECTION_ID?.trim() ?? ""

  if (!apiKey || !userId) {
    throw new Error("Missing COMPOSIO_API_KEY or COMPOSIO_USER_ID in .env")
  }

  console.warn(
    "[Composio] COMPOSIO_USER_ID / COMPOSIO_CONNECTION_ID from .env are deprecated. Connect Gmail per account in /settings/accounts.",
  )

  return {
    apiKey,
    userId,
    connectionId,
    gmailToolkitVersion: getGmailToolkitVersion(),
    timeoutMs: Number(process.env.COMPOSIO_2FA_TIMEOUT_MS ?? 90_000),
    pollMs: Number(process.env.COMPOSIO_2FA_POLL_MS ?? 5_000),
  }
}

export function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/")
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4))
  return Buffer.from(normalized + padding, "base64").toString("utf8")
}

export function extractAirbnbOtp(text: string): string | null {
  const keywordMatch = text.match(/(?:c[oó]digo|code)[\s\S]{0,120}?\b(\d{6})\b/i)
  if (keywordMatch?.[1]) return keywordMatch[1]

  const allMatches = [...text.matchAll(/\b(\d{6})\b/g)].map((m) => m[1])
  return allMatches[0] ?? null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null
}

function parseInternalDate(value: unknown): number {
  if (typeof value === "number") return value
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value)
  if (typeof value === "string") {
    const parsed = Date.parse(value)
    if (!Number.isNaN(parsed)) return parsed
  }
  return 0
}

function extractBodyFromPayload(payload: unknown): string {
  const root = asRecord(payload)
  if (!root) return ""

  const parts = root.parts
  if (Array.isArray(parts)) {
    const chunks: string[] = []
    for (const part of parts) {
      const partRecord = asRecord(part)
      const body = asRecord(partRecord?.body)
      const data = body?.data
      if (typeof data === "string") {
        chunks.push(decodeBase64Url(data))
      }
      const nested = partRecord?.parts
      if (Array.isArray(nested)) {
        chunks.push(extractBodyFromPayload({ parts: nested }))
      }
    }
    if (chunks.length > 0) return chunks.join("\n")
  }

  const body = asRecord(root.body)
  if (typeof body?.data === "string") {
    return decodeBase64Url(body.data)
  }

  return ""
}

function normalizeMessage(raw: unknown): GmailMessage | null {
  const record = asRecord(raw)
  if (!record) return null

  const payload = record.payload ?? record.messagePayload
  const headers = asRecord(payload)?.headers ?? record.headers

  let subject = typeof record.subject === "string" ? record.subject : undefined
  if (!subject && Array.isArray(headers)) {
    const subjectHeader = headers.find(
      (h) => asRecord(h)?.name?.toString().toLowerCase() === "subject",
    )
    subject = asRecord(subjectHeader)?.value?.toString()
  }

  const body =
    (typeof record.body === "string" ? record.body : undefined) ??
    (typeof record.messageText === "string" ? record.messageText : undefined) ??
    extractBodyFromPayload(payload)

  const snippet = typeof record.snippet === "string" ? record.snippet : undefined

  return {
    messageId: record.messageId?.toString() ?? record.id?.toString(),
    subject,
    internalDate: parseInternalDate(
      record.internalDate ?? record.internal_date ?? record.messageTimestamp,
    ),
    body: body || snippet,
    snippet,
  }
}

function extractMessages(result: unknown): GmailMessage[] {
  const root = asRecord(result)
  const data = asRecord(root?.data) ?? root
  const messages = data?.messages ?? data?.emails ?? data?.items

  if (!Array.isArray(messages)) return []

  return messages
    .map(normalizeMessage)
    .filter((message): message is GmailMessage => message !== null)
}

function isConnectedAccountNotFound(error: unknown): boolean {
  const cause = (error as { cause?: { error?: { error?: { slug?: string } } } }).cause
  return cause?.error?.error?.slug === "ActionExecute_ConnectedAccountNotFound"
}

async function executeGmailFetch(
  composio: Composio,
  config: ComposioConfig,
  includeConnectionId: boolean,
): Promise<unknown> {
  const params: Parameters<Composio["tools"]["execute"]>[1] = {
    userId: config.userId,
    version: config.gmailToolkitVersion,
    arguments: {
      query: GMAIL_QUERY,
      max_results: 10,
      include_payload: true,
      verbose: true,
    },
  }

  if (includeConnectionId && config.connectionId) {
    params.connectedAccountId = config.connectionId
  }

  return composio.tools.execute("GMAIL_FETCH_EMAILS", params)
}

function resolveConfig(configOverride?: Partial<Pick<ComposioConfig, "userId" | "connectionId">>): ComposioConfig {
  if (configOverride?.userId?.trim()) {
    return buildOtpConfigFromAccount({
      composioUserId: configOverride.userId,
      composioConnectionId: configOverride.connectionId ?? null,
    })
  }

  if (process.env.COMPOSIO_USER_ID?.trim()) {
    console.warn(
      "[Composio] Using COMPOSIO_USER_ID from .env (deprecated). Connect Gmail per account in /settings/accounts.",
    )
    return getComposioConfigFromEnv()
  }

  throw new Error(
    "No Composio userId provided. Connect Gmail for this account in /settings/accounts.",
  )
}

export async function fetchLatestAirbnbEmails(
  configOrOverride?: ComposioConfig | Partial<Pick<ComposioConfig, "userId" | "connectionId">>,
): Promise<GmailMessage[]> {
  const config =
    configOrOverride && "apiKey" in configOrOverride
      ? configOrOverride
      : resolveConfig(configOrOverride)

  const composio = new Composio({
    apiKey: config.apiKey,
    toolkitVersions: { gmail: config.gmailToolkitVersion },
  })

  let result: unknown
  try {
    result = await executeGmailFetch(composio, config, Boolean(config.connectionId))
  } catch (error) {
    if (config.connectionId && isConnectedAccountNotFound(error)) {
      result = await executeGmailFetch(composio, config, false)
    } else {
      const cause = (error as { cause?: { error?: { error?: { message?: string } } } }).cause?.error
        ?.error?.message
      if (cause) {
        throw new Error(`Composio Gmail: ${cause}`, { cause: error })
      }
      throw error
    }
  }

  const messages = extractMessages(result)
  return messages.sort(
    (a, b) => parseInternalDate(b.internalDate) - parseInternalDate(a.internalDate),
  )
}

export function findOtpInMessages(messages: GmailMessage[], sinceMs: number): string | null {
  for (const message of messages) {
    const internalDate = parseInternalDate(message.internalDate)
    if (internalDate > 0 && internalDate < sinceMs) continue

    const text = [message.subject, message.body, message.snippet].filter(Boolean).join("\n")
    const otp = extractAirbnbOtp(text)
    if (otp) return otp
  }

  return null
}

export async function waitForAirbnbOtp(
  sinceMs: number,
  configOverride?: Partial<Pick<ComposioConfig, "userId" | "connectionId">>,
): Promise<string> {
  const config = resolveConfig(configOverride)
  const deadline = Date.now() + config.timeoutMs
  let attempt = 0

  while (Date.now() < deadline) {
    attempt += 1
    const messages = await fetchLatestAirbnbEmails(config)
    const otp = findOtpInMessages(messages, sinceMs)

    if (otp) return otp

    await new Promise((resolve) => setTimeout(resolve, config.pollMs))
  }

  throw new Error(
    `No llegó correo de ${AIRBNB_SENDER} con código OTP en ${config.timeoutMs / 1000}s`,
  )
}
