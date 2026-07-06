import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { upsertLegacyProspectAccount } from '../src/accounts/account-repository'

dotenv.config({ path: path.resolve(__dirname, '../../../.env') })

const AUTH_FILE = path.resolve(__dirname, '../playwright/.auth/airbnb-session.json')

async function main() {
  const email = process.env.AIRBNB_EMAIL?.trim()
  if (!email) {
    console.error('AIRBNB_EMAIL is required to seed the legacy prospect account.')
    process.exit(1)
  }

  if (!fs.existsSync(AUTH_FILE)) {
    console.error(`Session file not found: ${AUTH_FILE}`)
    console.error('Run npm run auth:login first.')
    process.exit(1)
  }

  const account = await upsertLegacyProspectAccount({
    airbnbEmail: email,
    sessionPath: AUTH_FILE,
    label: process.env.PROSPECT_ACCOUNT_LABEL?.trim() || 'Legacy',
  })

  console.log(
    JSON.stringify(
      {
        action: 'seeded',
        accountId: account.id,
        label: account.label,
        airbnbEmail: account.airbnbEmail,
        sessionPath: account.sessionPath,
        status: account.status,
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error('seed-legacy-account failed:', error)
  process.exit(1)
})
