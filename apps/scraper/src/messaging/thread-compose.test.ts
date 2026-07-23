import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeThreadUrl, parseThreadIdFromUrl } from './thread-compose'

describe('parseThreadIdFromUrl', () => {
  it('extracts numeric thread id', () => {
    assert.equal(
      parseThreadIdFromUrl('https://www.airbnb.com.co/guest/messages/2599780483'),
      '2599780483',
    )
  })

  it('returns null for inbox root', () => {
    assert.equal(parseThreadIdFromUrl('https://www.airbnb.com.co/guest/messages'), null)
  })
})

describe('normalizeThreadUrl', () => {
  it('builds canonical thread url', () => {
    assert.equal(
      normalizeThreadUrl('https://www.airbnb.com.co/guest/messages/2599780483?foo=1'),
      'https://www.airbnb.com.co/guest/messages/2599780483',
    )
  })
})
