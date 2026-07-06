import dotenv from 'dotenv'
import path from 'path'
import { chromium } from 'playwright'
import { db } from '@repo/db'
import { sendColdOutboundMessage } from '../src/messaging/airbnb-messaging'
import { buildOutboundMessage } from '../src/messaging/outbound-templates'
import {
  getChromeChannelOption,
  getColombiaContextOptions,
} from '../src/scraping/airbnb-context'

dotenv.config({ path: path.resolve(__dirname, '../../../.env') })
const AUTH = path.resolve(__dirname, '../playwright/.auth/airbnb-session.json')

async function main() {
  const lead = await db.lead.findUniqueOrThrow({
    where: { id: '2b2d86f6-8828-47fd-9ddc-63597a99b1cd' },
  })
  const browser = await chromium.launch({ headless: true, ...getChromeChannelOption() })
  const page = await (
    await browser.newContext({ storageState: AUTH, ...getColombiaContextOptions() })
  ).newPage()

  const text = buildOutboundMessage(lead, 'PHASE_1_COLD').slice(0, 80) + ' [probe]'
  const result = await sendColdOutboundMessage(page, lead, text)
  console.log('Result:', result)

  await browser.close()
  await db.$disconnect()
}

main().catch(console.error)
