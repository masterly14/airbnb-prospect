import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { parseThreadId } from '@repo/airbnb-parse'
import { db } from '@repo/db'
import {
  extractListingIdsFromText,
  isLegacyManualThreadId,
  legacyThreadHostId,
  listingHostId,
  registerIdentityAlias,
  threadHostId,
} from '@repo/lead-contact'
import { getAirbnbBaseUrl } from '../src/scraping/airbnb-context'

dotenv.config({ path: path.resolve(__dirname, '../../../.env'), override: false })

type BackfillReport = {
  timestamp: string
  dryRun: boolean
  aliasesCreated: number
  aliasesExisting: number
  listingUrlsUpdated: number
  details: Array<{
    leadId: string
    hostAirbnbId: string
    action: 'alias_created' | 'alias_existing' | 'listing_url_updated'
    aliasId?: string
    listingId?: string
  }>
}

async function aliasExists(aliasId: string): Promise<boolean> {
  const row = await db.leadIdentityAlias.findUnique({ where: { aliasId } })
  return row != null
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const report: BackfillReport = {
    timestamp: new Date().toISOString(),
    dryRun,
    aliasesCreated: 0,
    aliasesExisting: 0,
    listingUrlsUpdated: 0,
    details: [],
  }

  const leads = await db.lead.findMany({ orderBy: { createdAt: 'asc' } })
  const baseUrl = getAirbnbBaseUrl()

  for (const lead of leads) {
    const canonicalId = lead.hostAirbnbId

    if (isLegacyManualThreadId(lead.hostAirbnbId)) {
      const threadNumeric = lead.hostAirbnbId.slice('manual:'.length)
      const normalizedId = threadHostId(threadNumeric)
      const aliasId = legacyThreadHostId(threadNumeric)

      if (!(await aliasExists(aliasId))) {
        if (!dryRun) {
          await registerIdentityAlias(db, {
            aliasId,
            canonicalId: normalizedId,
            leadId: lead.id,
          })
        }
        report.aliasesCreated++
        report.details.push({
          leadId: lead.id,
          hostAirbnbId: lead.hostAirbnbId,
          action: 'alias_created',
          aliasId,
        })
      } else {
        report.aliasesExisting++
      }
    }

    const threadNumeric = lead.threadId ? parseThreadId(lead.threadId) : null
    if (threadNumeric) {
      for (const aliasId of [threadHostId(threadNumeric), legacyThreadHostId(threadNumeric)]) {
        if (aliasId === canonicalId) continue
        if (await aliasExists(aliasId)) {
          report.aliasesExisting++
          continue
        }
        if (!dryRun) {
          await registerIdentityAlias(db, {
            aliasId,
            canonicalId,
            leadId: lead.id,
          })
        }
        report.aliasesCreated++
        report.details.push({
          leadId: lead.id,
          hostAirbnbId: lead.hostAirbnbId,
          action: 'alias_created',
          aliasId,
        })
      }
    }

    const messages = await db.message.findMany({
      where: { leadId: lead.id },
      select: { content: true },
    })
    const listingIds = new Set(
      extractListingIdsFromText(messages.map((message) => message.content).join('\n')),
    )
    if (lead.primaryListingUrl.includes('/rooms/')) {
      const match = lead.primaryListingUrl.match(/\/rooms\/(\d+)/)
      if (match?.[1]) listingIds.add(match[1])
    }

    let firstListingUrl: string | null = null
    for (const listingId of listingIds) {
      const aliasId = listingHostId(listingId)
      if (!(await aliasExists(aliasId))) {
        if (!dryRun) {
          await registerIdentityAlias(db, {
            aliasId,
            canonicalId,
            leadId: lead.id,
          })
        }
        report.aliasesCreated++
        report.details.push({
          leadId: lead.id,
          hostAirbnbId: lead.hostAirbnbId,
          action: 'alias_created',
          aliasId,
          listingId,
        })
      } else {
        report.aliasesExisting++
      }
      firstListingUrl ??= `${baseUrl}/rooms/${listingId}`
    }

    if (
      firstListingUrl &&
      lead.primaryListingUrl.includes('/guest/messages/') &&
      lead.primaryListingUrl !== firstListingUrl
    ) {
      if (!dryRun) {
        await db.lead.update({
          where: { id: lead.id },
          data: { primaryListingUrl: firstListingUrl },
        })
      }
      report.listingUrlsUpdated++
      report.details.push({
        leadId: lead.id,
        hostAirbnbId: lead.hostAirbnbId,
        action: 'listing_url_updated',
        listingId: firstListingUrl.match(/\/rooms\/(\d+)/)?.[1],
      })
    }
  }

  const reportsDir = path.resolve(__dirname, '../reports')
  fs.mkdirSync(reportsDir, { recursive: true })
  const reportPath = path.join(reportsDir, `backfill-lead-identity-aliases-${Date.now()}.json`)
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))

  console.log(
    JSON.stringify(
      { ...report, details: `${report.details.length} entries`, reportPath },
      null,
      2,
    ),
  )
}

main()
  .catch((error) => {
    console.error('backfill-lead-identity-aliases failed:', error)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
