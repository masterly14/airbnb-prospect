import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { LeadStatus } from '@repo/db'
import { isAiPausedStatus } from './conversation-pipeline'

describe('applyHumanTakeover contract', () => {
  it('treats HUMAN_TAKEOVER as ai-paused (idempotent re-entry must not re-notify)', () => {
    assert.equal(isAiPausedStatus(LeadStatus.HUMAN_TAKEOVER), true)
    assert.equal(isAiPausedStatus(LeadStatus.REPLIED_IN_PROGRESS), false)
  })
})
