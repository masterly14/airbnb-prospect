import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { triageOutputSchema } from './triage.js'

describe('triageOutputSchema', () => {
  it('accepts the four intent classes', () => {
    for (const intent of ['INTERESADO', 'DUDA_TECNICA', 'RECHAZO', 'AMBIGUO'] as const) {
      const result = triageOutputSchema.parse({
        intent,
        confidence: 'high',
        reason: 'Justificación breve.',
        shouldCloseLead: intent === 'RECHAZO',
        shouldInvokeNegotiator: intent === 'INTERESADO' || intent === 'DUDA_TECNICA',
        shouldHumanTakeover: false,
      })
      assert.equal(result.intent, intent)
    }
  })

  it('rejects an unknown intent', () => {
    assert.throws(() =>
      triageOutputSchema.parse({
        intent: 'MAYBE',
        confidence: 'high',
        reason: 'x',
        shouldCloseLead: false,
        shouldInvokeNegotiator: false,
        shouldHumanTakeover: false,
      }),
    )
  })

  it('rejects an invalid confidence', () => {
    assert.throws(() =>
      triageOutputSchema.parse({
        intent: 'INTERESADO',
        confidence: 'maybe',
        reason: 'x',
        shouldCloseLead: false,
        shouldInvokeNegotiator: true,
        shouldHumanTakeover: false,
      }),
    )
  })
})
