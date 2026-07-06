import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import {
  LeadStatus,
  MessageDirection,
  db,
} from '@repo/db'
import {
  inferContactSourceFromLead,
  isLeadContacted,
  markHostContacted,
} from '@repo/lead-contact'
import { fixInconsistentDiscoveredLead } from '../src/persistence/lead-identity-merge'

dotenv.config({ path: path.resolve(__dirname, '../../../.env') })

type BackfillReport = {
  timestamp: string
  dryRun: boolean
  created: number
  existing: number
  fixedInconsistent: number
  skippedNotContacted: number
  details: Array<{
    leadId: string
    hostAirbnbId: string
    action: 'created' | 'existing' | 'fixed' | 'skipped'
  }>
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const report: BackfillReport = {
    timestamp: new Date().toISOString(),
    dryRun,
    created: 0,
    existing: 0,
    fixedInconsistent: 0,
    skippedNotContacted: 0,
    details: [],
  }

  const leads = await db.lead.findMany({
    orderBy: { createdAt: 'asc' },
  })

  for (const lead of leads) {
    const outboundCount = await db.message.count({
      where: { leadId: lead.id, direction: MessageDirection.OUTBOUND },
    })
    const contacted =
      isLeadContacted(lead) || outboundCount > 0 || (await db.hostContact.findUnique({ where: { leadId: lead.id } }))

    if (!contacted) {
      report.skippedNotContacted++
      report.details.push({
        leadId: lead.id,
        hostAirbnbId: lead.hostAirbnbId,
        action: 'skipped',
      })
      continue
    }

    if (lead.status === LeadStatus.LEAD_DISCOVERED && (lead.threadId || outboundCount > 0)) {
      if (!dryRun) {
        await fixInconsistentDiscoveredLead(lead.id)
      }
      report.fixedInconsistent++
      report.details.push({
        leadId: lead.id,
        hostAirbnbId: lead.hostAirbnbId,
        action: 'fixed',
      })
    }

    const existing = await db.hostContact.findUnique({ where: { leadId: lead.id } })
    if (existing) {
      report.existing++
      report.details.push({
        leadId: lead.id,
        hostAirbnbId: lead.hostAirbnbId,
        action: 'existing',
      })
      continue
    }

    if (!dryRun) {
      const firstOutbound = await db.message.findFirst({
        where: { leadId: lead.id, direction: MessageDirection.OUTBOUND },
        orderBy: { sentAt: 'asc' },
      })
      const source = await inferContactSourceFromLead(db, lead.id)

      await markHostContacted(db, {
        lead,
        source,
        firstContactAccountId: firstOutbound?.prospectAccountId ?? null,
        firstContactedAt: lead.lastContactedAt ?? firstOutbound?.sentAt ?? new Date(),
      })
    }

    report.created++
    report.details.push({
      leadId: lead.id,
      hostAirbnbId: lead.hostAirbnbId,
      action: 'created',
    })
  }

  const reportsDir = path.resolve(__dirname, '../reports')
  fs.mkdirSync(reportsDir, { recursive: true })
  const reportPath = path.join(reportsDir, `backfill-host-contacts-${Date.now()}.json`)
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))

  console.log(JSON.stringify({ ...report, details: `${report.details.length} entries`, reportPath }, null, 2))
}

main()
  .catch((error) => {
    console.error('backfill-host-contacts failed:', error)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
