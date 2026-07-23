/**
 * Lista correos de una cuenta de prospección (Michell por defecto).
 *
 * Soporta rangos de fecha y paginación automática para llegar a correos de hace meses.
 *
 * Uso:
 *   npm run gmail:list
 *   npm run gmail:list -- --months 6 --limit 100
 *   npm run gmail:list -- --after 2025-10-01 --before 2026-01-01
 *   npm run gmail:list -- --older-than 3m --limit 50
 *   npm run gmail:list -- --query "from:airbnb.com" --limit 200
 *   npm run gmail:list -- --full
 */
import dotenv from 'dotenv'
import path from 'path'
import { buildOtpConfigFromAccount } from '@repo/composio'
import { db } from '@repo/db'
import { DEFAULT_MVP_ACCOUNT_ID } from '../src/accounts/mvp-mode'
import { fetchGmailEmails, type GmailMessage } from '../src/composio/gmail-otp'

dotenv.config({ path: path.resolve(__dirname, '../../../.env') })

const SCOPE = 'gmail:list'

function readArg(name: string): string | null {
  const idx = process.argv.indexOf(name)
  if (idx === -1) return null
  return process.argv[idx + 1]?.trim() || null
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name)
}

function parseLimit(): number {
  const raw = readArg('--limit')
  if (!raw) return 20
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 1 || value > 5000) {
    throw new Error('--limit debe ser un número entre 1 y 5000')
  }
  return Math.floor(value)
}

function toGmailDate(value: string): string {
  const normalized = value.trim().replace(/-/g, '/')
  if (!/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(normalized)) {
    throw new Error(`Fecha inválida "${value}". Usa YYYY-MM-DD o YYYY/MM/DD.`)
  }
  return normalized
}

function parseRelativeDuration(value: string, flag: string): string {
  const match = value.trim().match(/^(\d+)\s*(d|m|y)$/i)
  if (!match) {
    throw new Error(`${flag} debe ser como 30d, 6m o 1y (d=días, m=meses, y=años)`)
  }
  return `${match[1]}${match[2].toLowerCase()}`
}

function buildSearchQuery(): { query?: string; description: string } {
  const explicitQuery = readArg('--query')
  const parts: string[] = []
  const labels: string[] = []

  const after = readArg('--after')
  const before = readArg('--before')
  const months = readArg('--months')
  const newerThan = readArg('--newer-than')
  const olderThan = readArg('--older-than')

  if (after) {
    parts.push(`after:${toGmailDate(after)}`)
    labels.push(`desde ${toGmailDate(after)}`)
  }
  if (before) {
    parts.push(`before:${toGmailDate(before)}`)
    labels.push(`hasta ${toGmailDate(before)}`)
  }
  if (months) {
    const n = Number(months)
    if (!Number.isFinite(n) || n < 1 || n > 120) {
      throw new Error('--months debe ser un número entre 1 y 120')
    }
    parts.push(`newer_than:${Math.floor(n)}m`)
    labels.push(`últimos ${Math.floor(n)} meses`)
  }
  if (newerThan) {
    const token = parseRelativeDuration(newerThan, '--newer-than')
    parts.push(`newer_than:${token}`)
    labels.push(`más recientes que ${token}`)
  }
  if (olderThan) {
    const token = parseRelativeDuration(olderThan, '--older-than')
    parts.push(`older_than:${token}`)
    labels.push(`más antiguos que ${token}`)
  }
  if (explicitQuery) {
    parts.push(explicitQuery)
    labels.push(`query: ${explicitQuery}`)
  }

  if (parts.length === 0) {
    return { description: 'sin filtros (recientes del buzón)' }
  }

  return {
    query: parts.join(' '),
    description: labels.join(' | '),
  }
}

function formatDate(value: GmailMessage['internalDate']): string {
  if (value === undefined || value === null || value === '') return '(sin fecha)'
  const ms =
    typeof value === 'number'
      ? value
      : /^\d+$/.test(value)
        ? Number(value)
        : Date.parse(value)
  if (!Number.isFinite(ms) || ms <= 0) return String(value)
  return new Date(ms).toLocaleString('es-CO', { timeZone: 'America/Bogota' })
}

function preview(message: GmailMessage, fullBody: boolean): string {
  if (fullBody) {
    const text = message.body ?? message.snippet
    if (!text) return '(sin contenido)'
    return text.replace(/\s+/g, ' ').trim()
  }

  const text = message.snippet ?? message.body
  if (!text) return '(sin contenido)'
  const oneLine = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  return oneLine.length > 160 ? `${oneLine.slice(0, 157)}...` : oneLine
}

async function resolveAccount() {
  const accountId = readArg('--account-id') ?? DEFAULT_MVP_ACCOUNT_ID

  const account = await db.prospectAccount.findUnique({
    where: { id: accountId },
    select: {
      id: true,
      label: true,
      airbnbEmail: true,
      composioUserId: true,
      composioConnectionId: true,
    },
  })

  if (!account) {
    throw new Error(`ProspectAccount no encontrada: ${accountId}`)
  }

  if (!account.composioUserId && !account.id) {
    throw new Error(
      `La cuenta "${account.label}" no tiene Gmail conectado. Conéctala en /settings/accounts.`,
    )
  }

  return account
}

async function main() {
  const limit = parseLimit()
  const { query, description } = buildSearchQuery()
  const fullBody = hasFlag('--full')

  const account = await resolveAccount()
  const config = buildOtpConfigFromAccount(account)

  console.log(`[${SCOPE}] Cuenta: ${account.label} (${account.airbnbEmail})`)
  console.log(`[${SCOPE}] Límite: ${limit} | ${description}`)
  if (query) console.log(`[${SCOPE}] Gmail query: ${query}`)

  const messages = await fetchGmailEmails(config, {
    totalLimit: limit,
    includePayload: fullBody,
    ...(query ? { query } : {}),
  })

  if (messages.length === 0) {
    console.log(`[${SCOPE}] No se encontraron correos.`)
    process.exit(0)
  }

  const oldest = messages.at(-1)
  const newest = messages[0]
  console.log(
    `[${SCOPE}] ${messages.length} correo(s) | rango: ${formatDate(oldest?.internalDate)} → ${formatDate(newest?.internalDate)}\n`,
  )

  messages.forEach((message, index) => {
    console.log(`--- ${index + 1}/${messages.length} ---`)
    console.log(`Fecha:   ${formatDate(message.internalDate)}`)
    console.log(`De:      ${message.from ?? '(desconocido)'}`)
    console.log(`Asunto:  ${message.subject ?? '(sin asunto)'}`)
    if (message.messageId) console.log(`ID:      ${message.messageId}`)
    console.log(`Preview: ${preview(message, fullBody)}`)
    console.log('')
  })
}

main().catch((error) => {
  console.error(`[${SCOPE}]`, error instanceof Error ? error.message : String(error))
  process.exit(1)
})
