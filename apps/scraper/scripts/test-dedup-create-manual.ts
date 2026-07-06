/**
 * createManualLead no debe crear duplicados sobre hosts ya contactados.
 */
import dotenv from 'dotenv'
import path from 'path'
import { db } from '@repo/db'
import { prismaLeadRepository } from '../../web/lib/leads/prisma-repository'
import { LeadStatus } from '../../web/lib/leads/types'

dotenv.config({ path: path.resolve(__dirname, '../../../.env'), override: false })

const SEBASTIAN_LEAD_ID = '608364f9-b2ab-4376-8192-8ee57c178df0'
const LISTING_ID = process.env.DEDUP_TEST_LISTING_ID ?? '1599591058979163729'
const LISTING_URL = `https://www.airbnb.com.co/rooms/${LISTING_ID}`

async function main() {
  const failures: string[] = []
  const beforeCount = await db.lead.count()

  const result = await prismaLeadRepository.createManualLead({
    name: 'Sebastian',
    primaryListingUrl: LISTING_URL,
    status: LeadStatus.INITIAL_MSG_SENT,
    notes: 'test dedup — no debe crear',
  })

  const afterCount = await db.lead.count()

  if (result.created) {
    failures.push('createManualLead creó lead nuevo sobre host contactado')
  }
  if (afterCount > beforeCount) {
    failures.push(`createManualLead incrementó conteo de leads (${beforeCount} → ${afterCount})`)
  }
  if (!result.created && result.lead.status === LeadStatus.LEAD_DISCOVERED) {
    failures.push('createManualLead devolvió lead no contactado')
  }

  const passed = failures.length === 0

  console.log(
    JSON.stringify(
      {
        createResult: {
          created: result.created,
          leadId: result.lead.id,
          status: result.lead.status,
        },
        leadCountBefore: beforeCount,
        leadCountAfter: afterCount,
        failures,
        passed,
      },
      null,
      2,
    ),
  )

  await db.$disconnect()
  if (!passed) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
