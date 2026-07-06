import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { LeadStatus, MessageDirection } from '@repo/db'
import {
  normalizeMessageContent,
  messageContentKey,
  OUTBOUND_ACTIVE_STATUSES,
} from './inbound-pipeline'

describe('normalizeMessageContent', () => {
  it('normalizes whitespace and case', () => {
    assert.equal(normalizeMessageContent('  Hola   Mundo  '), 'hola mundo')
  })
})

describe('messageContentKey', () => {
  it('combines direction and normalized content', () => {
    const key = messageContentKey(MessageDirection.INBOUND, 'Hola')
    assert.equal(key, 'INBOUND:hola')
  })
})

describe('OUTBOUND_ACTIVE_STATUSES', () => {
  it('includes follow-up states but not REPLIED_IN_PROGRESS', () => {
    assert.ok(OUTBOUND_ACTIVE_STATUSES.includes(LeadStatus.INITIAL_MSG_SENT))
    assert.ok(OUTBOUND_ACTIVE_STATUSES.includes(LeadStatus.FOLLOW_UP_3_SENT))
    assert.equal(OUTBOUND_ACTIVE_STATUSES.includes(LeadStatus.REPLIED_IN_PROGRESS), false)
  })
})
