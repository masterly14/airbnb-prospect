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
  from?: string
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
  if (typeof value === "number" || (typeof value === "string" && /^\d+$/.test(value))) {
    const n = Number(value)
    // Gmail sometimes returns seconds; Date.now() is ms.
    return n > 0 && n < 1e12 ? n * 1000 : n
  }
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
  let from = typeof record.from === "string" ? record.from : undefined
  if (!from && typeof record.sender === "string") from = record.sender
  if (Array.isArray(headers)) {
    if (!subject) {
      const subjectHeader = headers.find(
        (h) => asRecord(h)?.name?.toString().toLowerCase() === "subject",
      )
      subject = asRecord(subjectHeader)?.value?.toString()
    }
    if (!from) {
      const fromHeader = headers.find(
        (h) => asRecord(h)?.name?.toString().toLowerCase() === "from",
      )
      from = asRecord(fromHeader)?.value?.toString()
    }
  }

  const body =
    (typeof record.body === "string" ? record.body : undefined) ??
    (typeof record.messageText === "string" ? record.messageText : undefined) ??
    extractBodyFromPayload(payload)

  const snippet = typeof record.snippet === "string" ? record.snippet : undefined

  return {
    messageId: record.messageId?.toString() ?? record.id?.toString(),
    subject,
    from,
    internalDate: parseInternalDate(
      record.internalDate ?? record.internal_date ?? record.messageTimestamp,
    ),
    body: body || snippet,
    snippet,
  }
}

function extractGmailFetchResult(result: unknown): {
  messages: GmailMessage[]
  nextPageToken?: string
} {
  const root = asRecord(result)
  const data = asRecord(root?.data) ?? root
  const nestedResponse = asRecord(data?.response)
  const nestedData = asRecord(nestedResponse?.data) ?? nestedResponse
  const payload = nestedData ?? data

  const messagesRaw = payload?.messages ?? payload?.emails ?? payload?.items
  const messages = Array.isArray(messagesRaw)
    ? messagesRaw
        .map(normalizeMessage)
        .filter((message): message is GmailMessage => message !== null)
    : []

  const nextPageToken =
    (typeof payload?.nextPageToken === "string" && payload.nextPageToken) ||
    (typeof data?.nextPageToken === "string" && data.nextPageToken) ||
    undefined

  return { messages, nextPageToken }
}

function isConnectedAccountNotFound(error: unknown): boolean {
  const cause = (error as { cause?: { error?: { error?: { slug?: string } } } }).cause
  return cause?.error?.error?.slug === "ActionExecute_ConnectedAccountNotFound"
}

export type FetchGmailEmailsOptions = {
  query?: string
  maxResults?: number
  includePayload?: boolean
  pageToken?: string
}

export type GmailEmailsPage = {
  messages: GmailMessage[]
  nextPageToken?: string
}

async function executeGmailFetch(
  composio: Composio,
  config: ComposioConfig,
  includeConnectionId: boolean,
  fetchOptions: FetchGmailEmailsOptions = {},
): Promise<unknown> {
  const argumentsPayload: Record<string, unknown> = {
    max_results: fetchOptions.maxResults ?? 10,
    include_payload: fetchOptions.includePayload ?? true,
    verbose: true,
  }

  if (fetchOptions.query !== undefined) {
    argumentsPayload.query = fetchOptions.query
  }

  if (fetchOptions.pageToken) {
    argumentsPayload.page_token = fetchOptions.pageToken
  }

  const params: Parameters<Composio["tools"]["execute"]>[1] = {
    userId: config.userId,
    version: config.gmailToolkitVersion,
    arguments: argumentsPayload,
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

async function fetchGmailEmailsPageInternal(
  config: ComposioConfig,
  fetchOptions: FetchGmailEmailsOptions = {},
): Promise<GmailEmailsPage> {
  const composio = new Composio({
    apiKey: config.apiKey,
    toolkitVersions: { gmail: config.gmailToolkitVersion },
  })

  let result: unknown
  try {
    result = await executeGmailFetch(composio, config, Boolean(config.connectionId), fetchOptions)
  } catch (error) {
    if (config.connectionId && isConnectedAccountNotFound(error)) {
      result = await executeGmailFetch(composio, config, false, fetchOptions)
    } else {
      const cause = (error as { cause?: { error?: { error?: { message?: string } } } }).cause?.error
        ?.error?.message
      if (cause) {
        throw new Error(`Composio Gmail: ${cause}`, { cause: error })
      }
      throw error
    }
  }

  const page = extractGmailFetchResult(result)
  page.messages.sort(
    (a, b) => parseInternalDate(b.internalDate) - parseInternalDate(a.internalDate),
  )
  return page
}

export async function fetchGmailEmailsPage(
  configOrOverride?: ComposioConfig | Partial<Pick<ComposioConfig, "userId" | "connectionId">>,
  fetchOptions: FetchGmailEmailsOptions = {},
): Promise<GmailEmailsPage> {
  const config =
    configOrOverride && "apiKey" in configOrOverride
      ? configOrOverride
      : resolveConfig(configOrOverride)

  return fetchGmailEmailsPageInternal(config, fetchOptions)
}

export async function fetchGmailEmails(
  configOrOverride?: ComposioConfig | Partial<Pick<ComposioConfig, "userId" | "connectionId">>,
  fetchOptions: FetchGmailEmailsOptions & { totalLimit?: number } = {},
): Promise<GmailMessage[]> {
  const config =
    configOrOverride && "apiKey" in configOrOverride
      ? configOrOverride
      : resolveConfig(configOrOverride)

  const totalLimit = fetchOptions.totalLimit ?? fetchOptions.maxResults ?? 10
  const pageSize = Math.min(500, totalLimit)
  const collected: GmailMessage[] = []
  const seenIds = new Set<string>()
  let pageToken = fetchOptions.pageToken

  while (collected.length < totalLimit) {
    const remaining = totalLimit - collected.length
    const page = await fetchGmailEmailsPageInternal(config, {
      ...fetchOptions,
      maxResults: Math.min(pageSize, remaining),
      pageToken,
    })

    for (const message of page.messages) {
      const id = message.messageId ?? ""
      if (id && seenIds.has(id)) continue
      if (id) seenIds.add(id)
      collected.push(message)
      if (collected.length >= totalLimit) break
    }

    if (!page.nextPageToken || page.messages.length === 0) break
    pageToken = page.nextPageToken
  }

  return collected.sort(
    (a, b) => parseInternalDate(b.internalDate) - parseInternalDate(a.internalDate),
  )
}

export async function fetchLatestAirbnbEmails(
  configOrOverride?: ComposioConfig | Partial<Pick<ComposioConfig, "userId" | "connectionId">>,
): Promise<GmailMessage[]> {
  return fetchGmailEmails(configOrOverride, { query: GMAIL_QUERY, maxResults: 10 })
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

/** How far before the OTP request we still accept Gmail messages (clock skew / UI lag). */
export const OTP_EMAIL_LOOKBACK_MS = 180_000

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

    if (otp) {
      console.log(
        JSON.stringify({
          ts: new Date().toISOString(),
          event: "otp.found",
          attempt,
          messages: messages.length,
        }),
      )
      return otp
    }

    const newest = messages[0]
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        event: "otp.poll",
        attempt,
        messages: messages.length,
        sinceMs,
        newestInternalDate: newest ? parseInternalDate(newest.internalDate) : null,
        newestSubject: newest?.subject ?? null,
      }),
    )

    await new Promise((resolve) => setTimeout(resolve, config.pollMs))
  }

  throw new Error(
    `No llegó correo de ${AIRBNB_SENDER} con código OTP en ${config.timeoutMs / 1000}s`,
  )
}
