import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  collectListingIdsFromLead,
  collectThreadIdsFromLead,
  extractListingIdsFromText,
  isLegacyManualThreadId,
  legacyThreadHostId,
  listingHostId,
  threadHostId,
} from './cluster'

describe('extractListingIdsFromText', () => {
  it('extracts listing ids from rooms and contact_host urls', () => {
    assert.deepEqual(
      extractListingIdsFromText(
        'https://www.airbnb.com.co/rooms/1599591058979163729 and /contact_host/1715477827914576124/send_message',
      ),
      ['1599591058979163729', '1715477827914576124'],
    )
  })
})

describe('manual host id helpers', () => {
  it('detects legacy thread ids', () => {
    assert.equal(isLegacyManualThreadId('manual:2583378434'), true)
    assert.equal(isLegacyManualThreadId('manual:thread-2583378434'), false)
    assert.equal(isLegacyManualThreadId('manual:listing-123'), false)
  })

  it('builds normalized ids', () => {
    assert.equal(listingHostId('123'), 'manual:listing-123')
    assert.equal(threadHostId('456'), 'manual:thread-456')
    assert.equal(legacyThreadHostId('456'), 'manual:456')
  })
})

describe('collectListingIdsFromLead', () => {
  it('collects from url and hostAirbnbId', () => {
    const ids = collectListingIdsFromLead({
      hostAirbnbId: 'manual:listing-999',
      primaryListingUrl: 'https://www.airbnb.com.co/rooms/111',
    })
    assert.deepEqual([...ids].sort(), ['111', '999'])
  })
})

describe('collectThreadIdsFromLead', () => {
  it('collects normalized, legacy and thread url ids', () => {
    assert.deepEqual(
      collectThreadIdsFromLead({
        hostAirbnbId: 'manual:2583378434',
        threadId: 'https://www.airbnb.com.co/guest/messages/2583378434',
      }),
      ['2583378434'],
    )
    assert.deepEqual(
      collectThreadIdsFromLead({
        hostAirbnbId: 'manual:thread-123',
        threadId: null,
      }),
      ['123'],
    )
  })
})
