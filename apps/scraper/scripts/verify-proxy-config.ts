import dotenv from 'dotenv'
import path from 'path'
import { db } from '@repo/db'
import { decryptSecret } from '@repo/crypto'
import {
  buildProxyOption,
  shouldBlockHeavyAssets,
  shouldUseAccountProxy,
  shouldUseAccountProxyForJob,
  type PlaywrightJob,
} from '../src/scraping/playwright-context'
import { parseDecodoUsername } from '../src/proxy/decodo'

dotenv.config({ path: path.resolve(__dirname, '../../../.env') })

async function main() {
  console.log('PLAYWRIGHT_USE_ACCOUNT_PROXY=', process.env.PLAYWRIGHT_USE_ACCOUNT_PROXY)
  console.log('shouldUseAccountProxy()=', shouldUseAccountProxy())
  console.log('PLAYWRIGHT_BLOCK_HEAVY_ASSETS=', shouldBlockHeavyAssets())

  const jobs: PlaywrightJob[] = ['outbound', 'login', 'harvest', 'inbound', 'sync']
  for (const job of jobs) {
    console.log(`  job=${job} → proxy=${shouldUseAccountProxyForJob(job)}`)
  }

  const accounts = await db.prospectAccount.findMany({ orderBy: { createdAt: 'asc' } })
  for (const account of accounts) {
    const proxy = buildProxyOption(account, {
      useProxy: shouldUseAccountProxyForJob('outbound'),
    })
    const parsed = parseDecodoUsername(account.proxyUser)
    const sessionId = account.proxySessionId ?? parsed.sessionId
    let passDecryptOk = false
    if (account.proxyPassEnc) {
      try {
        passDecryptOk = Boolean(decryptSecret(account.proxyPassEnc))
      } catch {
        passDecryptOk = false
      }
    }

    console.log(
      JSON.stringify({
        label: account.label,
        email: account.airbnbEmail,
        proxyProvider: account.proxyProvider,
        proxyHost: account.proxyHost,
        proxyPort: account.proxyPort,
        proxyCountry: account.proxyCountry ?? parsed.country,
        sessionId,
        passDecryptOk,
        playwrightServer: proxy?.server ?? null,
        playwrightUserSet: Boolean(proxy?.username),
        playwrightPassSet: Boolean(proxy?.password),
      }),
    )
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
