import { test, expect } from '@playwright/test'
import { db, LeadStatus } from './helpers/db-client'
import { pollLeadThread } from '../src/messaging/airbnb-inbox'

test.describe.configure({ mode: 'serial' })

test.describe('Inbound poll smoke', () => {
  test.afterAll(async () => {
    await db.$disconnect()
  })

  test('polls thread for lead with threadId', async ({ page }) => {
    test.setTimeout(300_000)

    const lead = await db.lead.findFirst({
      where: {
        threadId: { not: null },
        status: {
          in: [
            LeadStatus.INITIAL_MSG_SENT,
            LeadStatus.FOLLOW_UP_1_SENT,
            LeadStatus.FOLLOW_UP_2_SENT,
            LeadStatus.FOLLOW_UP_3_SENT,
            LeadStatus.REPLIED_IN_PROGRESS,
          ],
        },
      },
      orderBy: { lastContactedAt: 'asc' },
    })

    if (!lead) {
      test.skip(true, 'No lead with threadId eligible for inbound poll')
      return
    }

    const result = await pollLeadThread(page, lead)
    expect(result.success, result.error).toBe(true)

    console.log(
      `Inbound poll for ${lead.name}: inboundNew=${result.inboundNew}, replied=${result.replied}`,
    )
  })
})
