import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { legacyThreadHostId, threadHostId } from '@repo/lead-contact'
import { isManualHostId, isNumericHostId } from './lead-identity-merge'

describe('lead identity helpers', () => {
  it('detects manual and numeric host ids', () => {
    assert.equal(isManualHostId('manual:thread-123'), true)
    assert.equal(isManualHostId('manual:2583378434'), true)
    assert.equal(isManualHostId('12345678'), false)
    assert.equal(isNumericHostId('12345678'), true)
    assert.equal(isNumericHostId('manual:listing-1'), false)
  })

  it('uses normalized and legacy thread host ids', () => {
    assert.equal(threadHostId('2583378434'), 'manual:thread-2583378434')
    assert.equal(legacyThreadHostId('2583378434'), 'manual:2583378434')
  })
})
