import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { TriageResult } from '@repo/ai'
import { isCalLinkDue, shouldCloseLost, shouldEscalateLowConfidence } from './decisions'

function triage(overrides: Partial<TriageResult> = {}): TriageResult {
  return {
    intent: 'INTERESADO',
    confidence: 'high',
    reason: 'test',
    shouldCloseLead: false,
    shouldInvokeNegotiator: true,
    shouldHumanTakeover: false,
    ...overrides,
  }
}

describe('isCalLinkDue', () => {
  it('allows the link for INTERESADO when not sent yet', () => {
    assert.equal(isCalLinkDue('INTERESADO', false), true)
  })

  it('allows the link for DUDA_TECNICA when not sent yet', () => {
    assert.equal(isCalLinkDue('DUDA_TECNICA', false), true)
  })

  it('never re-sends the link once already sent', () => {
    assert.equal(isCalLinkDue('INTERESADO', true), false)
  })

  it('does not send the link for AMBIGUO', () => {
    assert.equal(isCalLinkDue('AMBIGUO', false), false)
  })
})

describe('shouldCloseLost', () => {
  it('closes on explicit rejection', () => {
    assert.equal(shouldCloseLost(triage({ intent: 'RECHAZO' })), true)
  })

  it('does not close on interest', () => {
    assert.equal(shouldCloseLost(triage({ intent: 'INTERESADO' })), false)
  })
})

describe('shouldEscalateLowConfidence', () => {
  it('escalates when low confidence and link already sent', () => {
    assert.equal(shouldEscalateLowConfidence(triage({ confidence: 'low' }), true), true)
  })

  it('does not escalate when link not sent', () => {
    assert.equal(shouldEscalateLowConfidence(triage({ confidence: 'low' }), false), false)
  })

  it('does not escalate when confidence high', () => {
    assert.equal(shouldEscalateLowConfidence(triage({ confidence: 'high' }), true), false)
  })
})
