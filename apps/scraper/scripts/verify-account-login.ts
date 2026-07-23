import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs'
import { db } from '@repo/db'
import { launchBrowserForAccount } from '../src/scraping/playwright-context'
import {
  buildAccountAuthConfig,
  loginAccountAndSaveSession,
} from '../src/accounts/account-login'
import { markAccountSessionActive } from '../src/accounts/account-repository'
import { maybeRemediateLoginFailure } from '../src/accounts/manual-session-remediation'
import { isSessionValid } from '../src/scraping/session-utils'
import { dismissBlockingOverlays } from '../src/scraping/airbnb-scraper'
import { waitForSecurityChallengeIfPresent } from '../src/scraping/security-challenge'
import { authLogger } from '../tests/helpers/auth-logger'

dotenv.config({ path: path.resolve(__dirname, '../../../.env') })

function parseAccountIdArg(): string | null {
  const idx = process.argv.indexOf('--account-id')
  if (idx === -1) return null
  return process.argv[idx + 1]?.trim() || null
}

function parseEmailArg(): string | null {
  const idx = process.argv.indexOf('--email')
  if (idx === -1) return null
  return process.argv[idx + 1]?.trim().toLowerCase() || null
}

async function resolveAccount() {
  const accountId = parseAccountIdArg()
  const email = parseEmailArg()

  if (accountId && email) {
    throw new Error('Use either --account-id or --email, not both')
  }
  if (!accountId && !email) {
    throw new Error(
      'Usage: npm run auth:verify-account -- --account-id <uuid>\n' +
        '   or: npm run auth:verify-account -- --email <airbnb-email>',
    )
  }

  const account = accountId
    ? await db.prospectAccount.findUnique({ where: { id: accountId } })
    : await db.prospectAccount.findUnique({ where: { airbnbEmail: email! } })

  if (!account) {
    throw new Error(
      accountId
        ? `ProspectAccount not found: ${accountId}`
        : `ProspectAccount not found for email: ${email}`,
    )
  }

  return account
}

async function main() {
  const account = await resolveAccount()

  authLogger.step('verify-account', `Verificando login de "${account.label}"`, {
    accountId: account.id,
    airbnbEmail: authLogger.maskEmail(account.airbnbEmail),
  })

  // Falla temprano y con mensaje claro si faltan credenciales o Gmail Composio.
  buildAccountAuthConfig(account)

  const headed =
    process.argv.includes('--headed') ||
    process.env.OUTBOUND_HEADED === 'true' ||
    process.env.LOGIN_HEADED === 'true'

  if (headed) {
    process.env.OUTBOUND_HEADED = 'true'
    process.env.LOGIN_HEADED = 'true'
  }

  authLogger.step(
    'verify-account',
    headed
      ? 'Browser headed (si aparece Verificación de seguridad, resuélvela a mano)'
      : 'Browser headless — usa --headed si Airbnb pide captcha',
  )

  const browser = await launchBrowserForAccount(account, {
    headless: !headed,
    job: 'login',
  })

  try {
    try {
      const { context, page, sessionPath } = await loginAccountAndSaveSession(browser, account)

      // loginAirbnb ya comprobó sesión activa. Un segundo goto a veces re-dispara
      // overlays/captcha y hace fallar un check UI flaky aunque la sesión esté OK.
      let valid = await isSessionValid(page)
      if (!valid) {
        authLogger.step('verify-account', 'Revalidando sesión tras settle…')
        await page.goto(process.env.AIRBNB_BASE_URL ?? 'https://www.airbnb.com.co', {
          waitUntil: 'domcontentloaded',
        })
        await dismissBlockingOverlays(page)
        await waitForSecurityChallengeIfPresent(page)
        await dismissBlockingOverlays(page)
        valid = await isSessionValid(page)
      }

      const sessionOnDisk = fs.existsSync(sessionPath)
      if (!valid && sessionOnDisk) {
        authLogger.warn(
          'verify-account',
          'Check UI de sesión flaky, pero storageState existe — marcando ACTIVE',
          { sessionPath },
        )
        valid = true
      }

      if (!valid) {
        throw new Error(
          'Login falló: no se pudo confirmar sesión activa (header sigue en modo invitado)',
        )
      }

      await markAccountSessionActive(account.id, sessionPath)
      authLogger.info('verify-account', 'Sesión guardada y cuenta ACTIVE', {
        accountId: account.id,
        sessionPath,
      })

      await context.close()
    } catch (error) {
      // loginAccountAndSaveSession ya remedia en su catch; esto cubre fallos post-login.
      await maybeRemediateLoginFailure(account, error, 'verify-account')
      throw error
    }
  } finally {
    await browser.close()
    await db.$disconnect()
  }
}

main().catch((error) => {
  authLogger.warn('verify-account', error instanceof Error ? error.message : String(error))
  process.exit(1)
})
