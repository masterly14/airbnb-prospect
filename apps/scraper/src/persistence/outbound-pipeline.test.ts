import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { LeadStatus } from '@repo/db'
import {
  addDays,
  includesCalLink,
  isColdLeadEligible,
  nextFollowUpForPhase,
  phaseForStatus,
  STATUS_TO_PHASE,
  PHASE_TRANSITIONS,
} from './outbound-pipeline'
import { ICP } from '../discovery/icp'

describe('isColdLeadEligible', () => {
  it('requires ICP range and superhost status', () => {
    assert.equal(
      isColdLeadEligible({
        totalProperties: 15,
        isSuperhost: true,
        market: 'Bogotá',
        primaryListingName: 'Apartamento',
        companyName: null,
        icpSkipReason: null,
      } as never),
      true,
    )
    assert.equal(
      isColdLeadEligible({
        totalProperties: ICP.MIN_PROPERTIES - 1,
        isSuperhost: true,
        icpSkipReason: null,
      } as never),
      false,
    )
  })
})

describe('includesCalLink', () => {
  it('detects cal.com in text', () => {
    assert.equal(includesCalLink('Agenda en cal.com/agent-pilot'), true)
    assert.equal(includesCalLink('Sin link aquí'), false)
  })
})

describe('phaseForStatus', () => {
  it('maps outbound statuses to phases', () => {
    assert.equal(phaseForStatus(LeadStatus.LEAD_DISCOVERED), 'PHASE_1_COLD')
    assert.equal(phaseForStatus(LeadStatus.INITIAL_MSG_SENT), 'PHASE_2_OPS')
    assert.equal(phaseForStatus(LeadStatus.FOLLOW_UP_1_SENT), 'PHASE_3_BI')
    assert.equal(phaseForStatus(LeadStatus.FOLLOW_UP_2_SENT), 'PHASE_4_BREAKUP')
    assert.equal(phaseForStatus(LeadStatus.REPLIED_IN_PROGRESS), null)
  })
})

describe('nextFollowUpForPhase', () => {
  it('schedules follow-up for phases 1-3', () => {
    const from = new Date('2026-01-01T12:00:00Z')
    const fu1 = nextFollowUpForPhase('PHASE_1_COLD', from)
    assert.ok(fu1)
    const expected = addDays(from, 3)
    assert.equal(fu1!.toISOString(), expected.toISOString())
  })

  it('returns null for break-up phase', () => {
    const from = new Date()
    assert.equal(nextFollowUpForPhase('PHASE_4_BREAKUP', from), null)
  })
})

describe('PHASE_TRANSITIONS', () => {
  it('closes lost after phase 4', () => {
    assert.equal(
      PHASE_TRANSITIONS.PHASE_4_BREAKUP.nextStatus,
      LeadStatus.CLOSED_LOST,
    )
  })

  it('covers all outbound phases', () => {
    assert.equal(Object.keys(STATUS_TO_PHASE).length, 4)
  })
})
