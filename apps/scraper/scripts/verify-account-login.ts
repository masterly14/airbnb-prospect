import dotenv from 'dotenv'
import path from 'path'
import { db } from '@repo/db'
import { launchBrowserForAccount } from '../src/scraping/playwright-context'
import {
  buildAccountAuthConfig,
  loginAccountAndSaveSession,
} from '../src/accounts/account-login'
import { markAccountSessionActive } from '../src/accounts/account-repository'
import { isSessionValid } from '../src/scraping/session-utils'
import { dismissBlockingOverlays } from '../src/scraping/airbnb-scraper'
import { authLogger } from '../tests/helpers/auth-logger'

dotenv.config({ path: path.resolve(__dirname, '../../../.env') })

function parseAccountIdArg(): string | null {
  const idx = process.argv.indexOf('--account-id')
  if (idx === -1) return null
  return process.argv[idx + 1]?.trim() || null
}

async function main() {
  const accountId = parseAccountIdArg()
  if (!accountId) {
    throw new Error('Usage: npm run auth:verify-account -- --account-id <prospect-account-uuid>')
  }

  const account = await db.prospectAccount.findUnique({ where: { id: accountId } })
  if (!account) {
    throw new Error(`ProspectAccount not found: ${accountId}`)
  }

  authLogger.step('verify-account', `Verificando login de "${account.label}"`, {
    accountId: account.id,
    airbnbEmail: authLogger.maskEmail(account.airbnbEmail),
  })

  // Falla temprano y con mensaje claro si faltan credenciales o Gmail Composio.
  buildAccountAuthConfig(account)

  const browser = await launchBrowserForAccount(account, {
    headless: process.env.OUTBOUND_HEADED !== 'true',
  })

  try {
    const { context, page, sessionPath } = await loginAccountAndSaveSession(browser, account)

    await page.goto(process.env.AIRBNB_BASE_URL ?? 'https://www.airbnb.com.co', {
      waitUntil: 'domcontentloaded',
    })
    await dismissBlockingOverlays(page)

    const valid = await isSessionValid(page)
    if (!valid) {
      throw new Error('Login completado pero la sesión no se validó como activa')
    }

    await markAccountSessionActive(account.id, sessionPath)
    authLogger.info('verify-account', 'Sesión guardada y cuenta ACTIVE', {
      accountId: account.id,
      sessionPath,
    })

    await context.close()
  } finally {
    await browser.close()
    await db.$disconnect()
  }
}

main().catch((error) => {
  authLogger.warn('verify-account', error instanceof Error ? error.message : String(error))
  process.exit(1)
})
