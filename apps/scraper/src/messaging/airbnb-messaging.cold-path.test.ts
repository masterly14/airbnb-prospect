import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Guardrail estático: el cold send no debe volver a escanear el inbox
 * antes de tipar (eso fue el bug que dejaba el browser en chats viejos).
 */
describe('sendColdOutboundMessage cold-path guardrails', () => {
  const source = readFileSync(path.join(__dirname, 'airbnb-messaging.ts'), 'utf8')

  it('does not call findExistingThreadForLead from the cold send path', () => {
    assert.equal(source.includes('findExistingThreadForLead'), false)
  })

  it('detects existing threads via contact_host redirect only', () => {
    assert.match(source, /contact_host_redirect/)
    assert.match(source, /ensureOnContactHostPage/)
    assert.match(source, /refusing_inbox_composer/)
  })
})
