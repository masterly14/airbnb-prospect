import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { extractThreadUrl } from './thread-detection'

describe('extractThreadUrl', () => {
  it('parses guest message URLs', () => {
    assert.equal(
      extractThreadUrl('https://www.airbnb.com.co/guest/messages/12345?thread_type=home_booking'),
      'https://www.airbnb.com.co/guest/messages/12345',
    )
    assert.equal(extractThreadUrl('https://www.airbnb.com.co/rooms/999'), null)
  })
})
