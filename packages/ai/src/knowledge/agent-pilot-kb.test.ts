import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { prefetchKnowledge } from './agent-pilot-kb.js'

describe('prefetchKnowledge', () => {
  it('matches integration questions', () => {
    const entries = prefetchKnowledge('¿se integra con mi PMS Guesty?')
    assert.ok(entries.some((e) => e.topic === 'integraciones'))
  })

  it('matches cleaning pain points', () => {
    const entries = prefetchKnowledge('tengo problemas con la limpieza entre reservas')
    assert.ok(entries.some((e) => e.topic === 'limpieza'))
  })

  it('returns empty for empty input', () => {
    assert.deepEqual(prefetchKnowledge(''), [])
  })

  it('caps the number of entries', () => {
    const entries = prefetchKnowledge('precio limpieza huespedes gastos integraciones bi', 2)
    assert.ok(entries.length <= 2)
  })
})
