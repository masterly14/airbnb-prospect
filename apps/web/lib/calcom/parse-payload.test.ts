import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  extractLeadIdFromMetadata,
  parseCalComWebhookBody,
  parseCalComWebhookJson,
} from './parse-payload'

describe('parseCalComWebhookBody', () => {
  it('parses BOOKING_CREATED payload', () => {
    const body = parseCalComWebhookBody({
      triggerEvent: 'BOOKING_CREATED',
      payload: {
        uid: 'booking-uid-1',
        bookingId: 42,
        startTime: '2026-06-26T15:00:00.000Z',
        endTime: '2026-06-26T15:15:00.000Z',
        type: 'diagnostico',
        metadata: { leadId: 'lead-abc' },
        attendees: [{ email: 'host@example.com', name: 'Ana' }],
      },
    })

    assert.ok(body)
    assert.equal(body.triggerEvent, 'BOOKING_CREATED')
    assert.equal(body.payload.uid, 'booking-uid-1')
    assert.equal(body.payload.bookingId, 42)
    assert.equal(extractLeadIdFromMetadata(body.payload.metadata), 'lead-abc')
  })

  it('returns null for invalid payload', () => {
    assert.equal(parseCalComWebhookBody({ triggerEvent: 'BOOKING_CREATED' }), null)
    assert.equal(parseCalComWebhookBody(null), null)
  })
})

describe('parseCalComWebhookJson', () => {
  it('parses JSON string', () => {
    const json = JSON.stringify({
      triggerEvent: 'BOOKING_CREATED',
      payload: {
        uid: 'uid-2',
        startTime: '2026-06-26T16:00:00.000Z',
        metadata: { leadId: 'lead-xyz' },
      },
    })

    const body = parseCalComWebhookJson(json)
    assert.ok(body)
    assert.equal(body.payload.uid, 'uid-2')
  })
})

describe('extractLeadIdFromMetadata', () => {
  it('returns null when metadata missing or empty leadId', () => {
    assert.equal(extractLeadIdFromMetadata(undefined), null)
    assert.equal(extractLeadIdFromMetadata({ leadId: '' }), null)
    assert.equal(extractLeadIdFromMetadata({ leadId: 123 }), null)
  })
})
