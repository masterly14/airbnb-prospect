import dotenv from 'dotenv'
import path from 'path'
import { db } from '@repo/db'
import { findEligibleOutboundLeads } from '../src/persistence/outbound-pipeline'
import { DEFAULT_MVP_ACCOUNT_ID } from '../src/accounts/mvp-mode'

dotenv.config({ path: path.resolve(__dirname, '../../../.env') })

async function main() {
  const account = await db.prospectAccount.findUnique({
    where: { id: DEFAULT_MVP_ACCOUNT_ID },
    select: {
      id: true,
      label: true,
      status: true,
      market: true,
      sessionStateEnc: true,
      sessionPath: true,
      cooldownUntil: true,
      waveMessagesSent: true,
      messagesSentToday: true,
      proxyHost: true,
    },
  })

  console.log(
    'Michell:',
    JSON.stringify(
      {
        ...account,
        sessionStateEnc: account?.sessionStateEnc ? 'set' : null,
      },
      null,
      2,
    ),
  )

  const leads = await findEligibleOutboundLeads(5, {
    market: account?.market ?? undefined,
  })

  console.log(`Leads elegibles (mercado ${account?.market ?? 'any'}): ${leads.length}`)
  for (const lead of leads) {
    console.log(
      JSON.stringify({
        id: lead.id,
        name: lead.name,
        market: lead.market,
        totalProperties: lead.totalProperties,
        isSuperhost: lead.isSuperhost,
        status: lead.status,
        listing: lead.primaryListingUrl,
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
