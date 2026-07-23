/**
 * Decodo residential sticky proxies (ex-Smartproxy).
 *
 * Docs:
 * - https://help.decodo.com/docs/residential-proxy-quick-start
 * - https://help.decodo.com/docs/residential-proxy-session-types
 * - https://help.decodo.com/docs/residential-proxy-custom-sticky-sessions
 *
 * Dos modos sticky (el dashboard suele mostrar el de puertos):
 * - `port` (default): gate.decodo.com:10001, 10002… — 1 puerto = 1 IP sticky
 * - `session`: gate.decodo.com:7000 + `session-<id>` en el username
 */

export const DECODO_PROVIDER = 'decodo' as const

export type DecodoStickyMode = 'port' | 'session'

export const DECODO_DEFAULTS = {
  host: 'gate.decodo.com',
  /** Sticky por puerto (como en Proxy setup → Sticky 60min). */
  stickyMode: 'port' as DecodoStickyMode,
  /** Primer puerto sticky del dashboard. */
  stickyPortStart: 10001,
  /** Puerto backconnect cuando stickyMode=session. */
  sessionPort: 7000,
  country: 'co',
  /** Alinear con el dropdown Sticky (60min) del dashboard. */
  sessionDurationMinutes: 60,
} as const

export type DecodoStickyInput = {
  /** Usuario base del dashboard Decodo (sin prefijo `user-` ni parámetros). */
  username: string
  password: string
  /** Identificador estable: session id o, en modo port, el puerto como string. */
  sessionId: string
  country?: string | null
  sessionDurationMinutes?: number
  host?: string
  port?: number
  stickyMode?: DecodoStickyMode
}

export type DecodoProxyCredentials = {
  provider: typeof DECODO_PROVIDER
  stickyMode: DecodoStickyMode
  host: string
  port: number
  user: string
  pass: string
  sessionId: string
  country: string | null
  sessionDurationMinutes: number
}

/** Quita el prefijo `user-` si el usuario lo pegó desde el dashboard. */
export function normalizeDecodoBaseUsername(username: string): string {
  const trimmed = username.trim()
  // Si pegó el username completo con params, quedarse con el segmento base.
  const withoutPrefix = trimmed.toLowerCase().startsWith('user-')
    ? trimmed.slice(5)
    : trimmed
  const base = withoutPrefix.split('-')[0]?.trim()
  return base || withoutPrefix
}

/**
 * Session id / etiqueta estable a partir de la cuenta.
 * Preferir `proxySessionId` ya guardado para no rotar la IP al reasignar.
 */
export function resolveDecodoSessionId(account: {
  id: string
  label: string
  proxySessionId?: string | null
}): string {
  const existing = account.proxySessionId?.trim()
  if (existing) return existing

  const slug = account.label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 16)

  const shortId = account.id.replace(/-/g, '').slice(0, 8)
  return `${slug || 'acct'}${shortId}`
}

/** Puerto sticky para la cuenta en índice 0..n-1. */
export function resolveDecodoStickyPort(
  accountIndex: number,
  stickyPortStart = DECODO_DEFAULTS.stickyPortStart,
): number {
  if (accountIndex < 0) throw new Error('accountIndex must be >= 0')
  return stickyPortStart + accountIndex
}

export function buildDecodoUsername(input: {
  username: string
  stickyMode?: DecodoStickyMode
  sessionId?: string
  country?: string | null
  sessionDurationMinutes?: number
}): string {
  const base = normalizeDecodoBaseUsername(input.username)
  if (!base) throw new Error('Decodo username is required')

  const stickyMode = input.stickyMode ?? DECODO_DEFAULTS.stickyMode
  const duration = clampSessionDuration(
    input.sessionDurationMinutes ?? DECODO_DEFAULTS.sessionDurationMinutes,
  )

  const parts = [`user-${base}`]

  const country = input.country?.trim().toLowerCase()
  if (country) {
    parts.push(`country-${country}`)
  }

  if (stickyMode === 'session') {
    const sessionId = input.sessionId?.trim()
    if (!sessionId) throw new Error('Decodo sessionId is required in session mode')
    parts.push(`session-${sessionId}`)
  }

  parts.push(`sessionduration-${duration}`)
  return parts.join('-')
}

export function buildDecodoProxyCredentials(input: DecodoStickyInput): DecodoProxyCredentials {
  const stickyMode = input.stickyMode ?? DECODO_DEFAULTS.stickyMode
  const sessionDurationMinutes = clampSessionDuration(
    input.sessionDurationMinutes ?? DECODO_DEFAULTS.sessionDurationMinutes,
  )
  const sessionId = input.sessionId.trim()
  const host = input.host?.trim() || DECODO_DEFAULTS.host
  const countryRaw = input.country === undefined ? DECODO_DEFAULTS.country : input.country
  const country = countryRaw?.trim().toLowerCase() || null

  const port =
    input.port ??
    (stickyMode === 'port'
      ? Number.parseInt(sessionId, 10) || DECODO_DEFAULTS.stickyPortStart
      : DECODO_DEFAULTS.sessionPort)

  if (!input.password.trim()) {
    throw new Error('Decodo password is required')
  }
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`Invalid Decodo port: ${port}`)
  }

  return {
    provider: DECODO_PROVIDER,
    stickyMode,
    host,
    port,
    user: buildDecodoUsername({
      username: input.username,
      stickyMode,
      sessionId: stickyMode === 'session' ? sessionId : undefined,
      country,
      sessionDurationMinutes,
    }),
    pass: input.password,
    sessionId,
    country,
    sessionDurationMinutes,
  }
}

export type ParsedDecodoUsername = {
  baseUsername: string | null
  country: string | null
  sessionId: string | null
  sessionDurationMinutes: number | null
}

/** Extrae parámetros del username Decodo (o nulls si el formato no coincide). */
export function parseDecodoUsername(proxyUser: string | null | undefined): ParsedDecodoUsername {
  if (!proxyUser) {
    return {
      baseUsername: null,
      country: null,
      sessionId: null,
      sessionDurationMinutes: null,
    }
  }

  const sessionId = proxyUser.match(/-session-([^-]+)/)?.[1] ?? null
  const country = proxyUser.match(/-country-([a-z]{2})(?:-|$)/i)?.[1]?.toLowerCase() ?? null
  const durationRaw = proxyUser.match(/-sessionduration-(\d+)/)?.[1]
  const sessionDurationMinutes = durationRaw ? Number.parseInt(durationRaw, 10) : null

  let baseUsername: string | null = null
  const withoutPrefix = proxyUser.replace(/^user-/i, '')
  const baseMatch = withoutPrefix.match(/^([^-]+)/)
  if (baseMatch) baseUsername = baseMatch[1] ?? null

  return { baseUsername, country, sessionId, sessionDurationMinutes }
}

function clampSessionDuration(minutes: number): number {
  if (!Number.isFinite(minutes)) return DECODO_DEFAULTS.sessionDurationMinutes
  return Math.min(1440, Math.max(1, Math.trunc(minutes)))
}

export type DecodoEnvConfig = {
  username: string
  password: string
  host: string
  stickyMode: DecodoStickyMode
  stickyPortStart: number
  sessionPort: number
  country: string | null
  sessionDurationMinutes: number
}

/** Lee credenciales Decodo desde env (para assign / scripts). */
export function readDecodoEnv(env: NodeJS.ProcessEnv = process.env): DecodoEnvConfig {
  const username = env.DECODO_USERNAME?.trim() || env.DECODO_PROXY_USER?.trim()
  const password = env.DECODO_PASSWORD?.trim() || env.DECODO_PROXY_PASS?.trim()

  if (!username) {
    throw new Error(
      'Missing DECODO_USERNAME (usuario del dashboard Decodo, sin prefijo user-)',
    )
  }
  if (!password) {
    throw new Error('Missing DECODO_PASSWORD')
  }

  const modeRaw = (env.DECODO_STICKY_MODE?.trim() || DECODO_DEFAULTS.stickyMode).toLowerCase()
  const stickyMode: DecodoStickyMode = modeRaw === 'session' ? 'session' : 'port'

  const stickyPortStartRaw = env.DECODO_STICKY_PORT_START?.trim()
  const stickyPortStart = stickyPortStartRaw
    ? Number.parseInt(stickyPortStartRaw, 10)
    : DECODO_DEFAULTS.stickyPortStart

  const sessionPortRaw = env.DECODO_PORT?.trim()
  const sessionPort = sessionPortRaw
    ? Number.parseInt(sessionPortRaw, 10)
    : DECODO_DEFAULTS.sessionPort

  const durationRaw = env.DECODO_SESSION_DURATION_MINUTES?.trim()
  const sessionDurationMinutes = durationRaw
    ? Number.parseInt(durationRaw, 10)
    : DECODO_DEFAULTS.sessionDurationMinutes

  // country vacío / "random" / "none" → sin targeting (como Location=Random del dashboard)
  const countryRaw = env.DECODO_COUNTRY?.trim().toLowerCase()
  const country =
    !countryRaw || countryRaw === 'random' || countryRaw === 'none' || countryRaw === 'off'
      ? null
      : countryRaw

  return {
    username,
    password,
    host: env.DECODO_HOST?.trim() || DECODO_DEFAULTS.host,
    stickyMode,
    stickyPortStart,
    sessionPort,
    country: country ?? (stickyMode === 'session' ? DECODO_DEFAULTS.country : null),
    sessionDurationMinutes: clampSessionDuration(sessionDurationMinutes),
  }
}
