import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { LeadStatus } from '@repo/db'
import {
  compareLeadStatus,
  evaluateContactBlock,
  isLeadContacted,
  pickAdvancedStatus,
} from '.'

describe('isLeadContacted', () => {
  it('returns false only for discovered leads without thread', () => {
    assert.equal(
      isLeadContacted({ status: LeadStatus.LEAD_DISCOVERED, threadId: null }),
      false,
    )
    assert.equal(
      isLeadContacted({ status: LeadStatus.LEAD_DISCOVERED, threadId: 'https://x/messages/1' }),
      true,
    )
    assert.equal(isLeadContacted({ status: LeadStatus.INITIAL_MSG_SENT }), true)
  })
})

describe('evaluateContactBlock', () => {
  it('blocks on any contact signal', () => {
    const lead = { status: LeadStatus.LEAD_DISCOVERED, threadId: null }

    assert.equal(
      evaluateContactBlock({ lead, hasOutboundMessage: false, hasHostContact: false }),
      null,
    )
    assert.equal(
      evaluateContactBlock({ lead, hasOutboundMessage: true, hasHostContact: false }),
      'outbound_message_exists',
    )
    assert.equal(
      evaluateContactBlock({ lead, hasOutboundMessage: false, hasHostContact: true }),
      'host_contact_ledger',
    )
    assert.equal(
      evaluateContactBlock({
        lead: { status: LeadStatus.INITIAL_MSG_SENT, threadId: null },
        hasOutboundMessage: false,
        hasHostContact: false,
      }),
      'status_not_discovered',
    )
  })
})

describe('compareLeadStatus', () => {
  it('ranks pipeline progression', () => {
    assert.ok(
      compareLeadStatus(LeadStatus.REPLIED_IN_PROGRESS, LeadStatus.INITIAL_MSG_SENT) > 0,
    )
    assert.equal(
      pickAdvancedStatus(LeadStatus.INITIAL_MSG_SENT, LeadStatus.HUMAN_TAKEOVER),
      LeadStatus.HUMAN_TAKEOVER,
    )
  })
})
