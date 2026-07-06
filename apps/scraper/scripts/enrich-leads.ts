import dotenv from 'dotenv'
import path from 'path'
import { harvestLog } from '../src/logging/harvest-logger'
import { enrichLeadRecord } from '../src/enrichment/enrich-lead'
import { findLeadsPendingEnrichment } from '../src/persistence/lead-repository'
import { sleep } from '../src/resilience/retry'
import { db } from '@repo/db'

dotenv.config({ path: path.resolve(__dirname, '../../../.env') })

const BATCH_SIZE = Number.parseInt(process.env.ENRICH_BATCH_SIZE ?? '10', 10)
const RETRY_DELAY_MS = 2_000

export type EnrichReport = {
  timestamp: string
  processed: number
  success: number
  failed: number
}

export async function runEnrichment(options: { batchSize?: number } = {}): Promise<EnrichReport> {
  if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error('Missing DEEPSEEK_API_KEY. Add it to .env')
  }

  const batchSize = options.batchSize ?? BATCH_SIZE
  const leads = await findLeadsPendingEnrichment(batchSize)

  const report: EnrichReport = {
    timestamp: new Date().toISOString(),
    processed: leads.length,
    success: 0,
    failed: 0,
  }

  if (leads.length === 0) {
    console.log('No leads pending enrichment.')
    await db.$disconnect()
    return report
  }

  console.log(`Enriching ${leads.length} lead(s)...`)

  for (const lead of leads) {
    const ok = await enrichLeadRecord(lead)
    if (ok) report.success++
    else report.failed++
    await sleep(RETRY_DELAY_MS)
  }

  console.log(`Enrichment complete: ${report.success} success, ${report.failed} failed`)
  await db.$disconnect()
  return report
}

async function main() {
  try {
    await runEnrichment()
  } catch (error) {
    console.error('enrich-leads failed:', error)
    process.exit(1)
  }
}

if (require.main === module) {
  main()
}
