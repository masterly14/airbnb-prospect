import { test, expect } from '@playwright/test'
import { db, LeadStatus, MessageDirection } from './helpers/db-client'
import { buildOutboundMessage } from '../src/messaging/outbound-templates'
import { sendOutboundMessage } from '../src/messaging/airbnb-messaging'
import {
  applyOutboundTransition,
  phaseForStatus,
  recordOutboundMessage,
} from '../src/persistence/outbound-pipeline'

test.describe.configure({ mode: 'serial' })

test.describe('Outbound send smoke', () => {
  test.afterAll(async () => {
    await db.$disconnect()
  })

  test('sends phase 1 cold message to eligible lead', async ({ page }) => {
    test.setTimeout(300_000)

    const lead = await db.lead.findFirst({
      where: {
        status: LeadStatus.LEAD_DISCOVERED,
        totalProperties: { gte: 2 },
      },
      orderBy: { createdAt: 'asc' },
    })

    if (!lead) {
      test.skip(true, 'No LEAD_DISCOVERED leads with totalProperties >= 2')
      return
    }

    const phase = phaseForStatus(lead.status)
    expect(phase).toBe('PHASE_1_COLD')

    const text = buildOutboundMessage(lead, phase!)
    expect(text.toLowerCase()).not.toContain('cal.com')

    const result = await sendOutboundMessage(page, lead, text, true, phase!)
    expect(result.success, result.error).toBe(true)
    expect(result.threadId).toBeTruthy()

    await recordOutboundMessage(lead.id, text, phase!)
    const updated = await applyOutboundTransition(lead.id, phase!, {
      content: text,
      threadId: result.threadId,
    })

    expect(updated.status).toBe(LeadStatus.INITIAL_MSG_SENT)
    expect(updated.threadId).toBeTruthy()
    expect(updated.lastContactedAt).toBeTruthy()
    expect(updated.nextFollowUpAt).toBeTruthy()

    const outboundMsg = await db.message.findFirst({
      where: {
        leadId: lead.id,
        direction: MessageDirection.OUTBOUND,
      },
    })
    expect(outboundMsg).toBeTruthy()
    expect(outboundMsg?.content).toBe(text)
  })
})
