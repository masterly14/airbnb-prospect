/**
 * Asigna proxies Decodo sticky a ProspectAccount.
 *
 * Modo default (como en tu dashboard Proxy setup → Sticky):
 *   1 cuenta = 1 puerto sticky (10001, 10002, …)
 *   username = user-<DECODO_USERNAME>-sessionduration-60
 *
 * Requiere en `.env`:
 *   DECODO_USERNAME=...   # parte visible en Username (sin user- ni -sessionduration-…)
 *   DECODO_PASSWORD=...
 * Opcional:
 *   DECODO_STICKY_MODE=port          # o session
 *   DECODO_STICKY_PORT_START=10001
 *   DECODO_SESSION_DURATION_MINUTES=60
 *   DECODO_COUNTRY=random            # o co / us / …
 *   DECODO_HOST=gate.decodo.com
 *
 * Uso:
 *   npm run proxy:assign-decodo -- --dry-run
 *   npm run proxy:assign-decodo -- --test-only
 *   npm run proxy:assign-decodo
 *   npm run proxy:assign-decodo -- --email svaron066@gmail.com
 */
import dotenv from 'dotenv'
import path from 'path'
import { db } from '@repo/db'
import { encryptSecret } from '@repo/crypto'
import {
  buildDecodoProxyCredentials,
  parseDecodoUsername,
  readDecodoEnv,
  resolveDecodoSessionId,
  resolveDecodoStickyPort,
  type DecodoProxyCredentials,
} from '../src/proxy/decodo'

dotenv.config({ path: path.resolve(__dirname, '../../../.env') })

function maskUser(user: string): string {
  const parsed = parseDecodoUsername(user)
  const base = parsed.baseUsername ?? '?'
  const duration = parsed.sessionDurationMinutes ?? '?'
  if (parsed.sessionId) {
    return `user-${base}-…-session-${parsed.sessionId}-sessionduration-${duration}`
  }
  if (parsed.country) {
    return `user-${base}-country-${parsed.country}-sessionduration-${duration}`
  }
  return `user-${base}-sessionduration-${duration}`
}

async function testProxy(
  proxy: Pick<DecodoProxyCredentials, 'host' | 'port' | 'user' | 'pass' | 'sessionId'>,
): Promise<{ ok: boolean; ip?: string; error?: string }> {
  try {
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const execFileAsync = promisify(execFile)

    const { stdout, stderr } = await execFileAsync(
      'curl.exe',
      [
        '-sS',
        '--max-time',
        '25',
        '-x',
        `${proxy.host}:${proxy.port}`,
        '-U',
        `${proxy.user}:${proxy.pass}`,
        'https://ip.decodo.com/json',
      ],
      { encoding: 'utf8' },
    )

    if (!stdout.trim()) {
      return { ok: false, error: stderr || 'empty response' }
    }

    const data = JSON.parse(stdout) as {
      proxy?: { ip?: string }
      ip?: string
      city?: string
      country?: string
      country_code?: string
      error?: string | { message?: string }
    }

    if (typeof data.error === 'string') {
      return { ok: false, error: data.error }
    }
    if (data.error && typeof data.error === 'object' && data.error.message) {
      return { ok: false, error: data.error.message }
    }

    const ip = data.proxy?.ip ?? data.ip
    if (!ip) {
      return { ok: false, error: `unexpected response: ${stdout.slice(0, 200)}` }
    }

    const city =
      typeof data.city === 'string'
        ? data.city
        : typeof data.city === 'object' && data.city !== null && 'name' in data.city
          ? String((data.city as { name?: string }).name ?? '?')
          : '?'
    const country =
      data.country_code ??
      (typeof data.country === 'string'
        ? data.country
        : typeof data.country === 'object' && data.country !== null && 'name' in data.country
          ? String((data.country as { name?: string }).name ?? '?')
          : '?')
    return { ok: true, ip: `${ip} (${city}, ${country})` }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function parseEmailFilter(argv: string[]): string | null {
  const idx = argv.indexOf('--email')
  if (idx === -1) return null
  return argv[idx + 1]?.trim().toLowerCase() || null
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const testOnly = process.argv.includes('--test-only')
  const emailFilter = parseEmailFilter(process.argv)

  const env = readDecodoEnv()
  console.log(
    `[decodo] mode=${env.stickyMode} host=${env.host} duration=${env.sessionDurationMinutes}m country=${env.country ?? 'random'}`,
  )
  if (env.stickyMode === 'port') {
    console.log(`[decodo] sticky ports from ${env.stickyPortStart}`)
  }

  const accounts = await db.prospectAccount.findMany({
    where: emailFilter ? { airbnbEmail: emailFilter } : undefined,
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      label: true,
      airbnbEmail: true,
      status: true,
      proxyHost: true,
      proxyPort: true,
      proxyUser: true,
      proxySessionId: true,
    },
  })

  if (emailFilter && accounts.length === 0) {
    throw new Error(`No hay ProspectAccount con email ${emailFilter}`)
  }
  if (accounts.length === 0) {
    throw new Error('No hay ProspectAccount en la DB')
  }

  const assignments = accounts.map((account, index) => {
    const stickyPort = resolveDecodoStickyPort(index, env.stickyPortStart)
    const sessionId =
      env.stickyMode === 'port'
        ? // Reusar puerto ya guardado si existe y es sticky (>=10001)
          account.proxySessionId?.match(/^\d+$/) &&
          Number(account.proxySessionId) >= env.stickyPortStart
            ? account.proxySessionId
            : String(stickyPort)
        : resolveDecodoSessionId(account)

    const creds = buildDecodoProxyCredentials({
      username: env.username,
      password: env.password,
      sessionId,
      country: env.country,
      sessionDurationMinutes: env.sessionDurationMinutes,
      host: env.host,
      port: env.stickyMode === 'port' ? Number.parseInt(sessionId, 10) : env.sessionPort,
      stickyMode: env.stickyMode,
    })
    return { account, creds }
  })

  console.log(`[decodo] ${assignments.length} cuenta(s)`)
  for (const { account, creds } of assignments) {
    console.log(
      `  - ${account.label}: ${creds.host}:${creds.port} / ${maskUser(creds.user)}`,
    )
  }

  const identityKey = (c: DecodoProxyCredentials) =>
    env.stickyMode === 'port' ? String(c.port) : c.sessionId
  const counts = new Map<string, number>()
  for (const { creds } of assignments) {
    const key = identityKey(creds)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const dupes = [...counts.entries()].filter(([, n]) => n > 1)
  if (dupes.length > 0) {
    throw new Error(
      `Identidades sticky duplicadas (cada cuenta necesita puerto/session único): ${dupes
        .map(([s]) => s)
        .join(', ')}`,
    )
  }

  if (testOnly) {
    console.log('\n[decodo] Probando conectividad…')
    for (const { account, creds } of assignments) {
      const result = await testProxy(creds)
      if (result.ok) {
        console.log(`  ✅ ${account.label} :${creds.port} → ${result.ip}`)
      } else {
        console.log(`  ❌ ${account.label} :${creds.port} → ${result.error}`)
      }
    }
    return
  }

  for (const { account, creds } of assignments) {
    console.log(
      `\n[decodo] ${dryRun ? 'DRY-RUN' : 'UPDATE'} "${account.label}" (${account.airbnbEmail})`,
    )
    console.log(`  → ${creds.host}:${creds.port} / ${maskUser(creds.user)}`)

    if (!dryRun) {
      await db.prospectAccount.update({
        where: { id: account.id },
        data: {
          proxyHost: creds.host,
          proxyPort: creds.port,
          proxyUser: creds.user,
          proxyPassEnc: encryptSecret(creds.pass),
          proxyProvider: creds.provider,
          proxySessionId: creds.sessionId,
          proxyCountry: creds.country,
        },
      })
    }
  }

  console.log('\n[decodo] Probando conectividad de los proxies asignados…')
  const ips = new Set<string>()
  let failures = 0

  for (const { account, creds } of assignments) {
    const result = await testProxy(creds)
    if (result.ok) {
      console.log(`  ✅ ${account.label}: ${result.ip}`)
      if (result.ip) ips.add(result.ip.split(' ')[0]!)
    } else {
      failures += 1
      console.log(`  ❌ ${account.label}: ${result.error}`)
    }
  }

  console.log(`\n[decodo] IPs únicas: ${ips.size}/${assignments.length}`)
  if (failures > 0) {
    console.warn(
      `[decodo] ${failures} fallo(s). Revisa usuario/password y tráfico en el dashboard Decodo.`,
    )
    process.exitCode = 1
  } else if (ips.size < assignments.length) {
    console.warn(
      '[decodo] Algunas cuentas compartieron IP — verifica que cada una tenga puerto sticky distinto.',
    )
    process.exitCode = 1
  } else {
    console.log('[decodo] OK: cada cuenta sale por IP distinta.')
  }
}

main()
  .catch((error) => {
    console.error('[decodo]', error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
