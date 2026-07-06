import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildBriefing,
  isKillSwitchTriggered,
  lastInboundMessage,
  type LeadAgentContext,
} from './lead-context.js'

function makeContext(overrides: Partial<LeadAgentContext['lead']> = {}): LeadAgentContext {
  return {
    lead: {
      id: 'lead-1',
      hostAirbnbId: 'host-1',
      name: 'Carlos Rivera',
      hostProfileUrl: 'https://airbnb.com/users/show/1',
      primaryListingUrl: 'https://airbnb.com/rooms/1',
      primaryListingName: 'Apto Centro',
      totalProperties: 12,
      companyName: null,
      status: 'REPLIED_IN_PROGRESS',
      businessScale: 'Operador mediano',
      painPoints: 'Coordinación de limpieza',
      executiveSummary: null,
      threadId: 'https://airbnb.com.co/guest/messages/123',
      botReplyCount: 0,
      calLinkSent: false,
      lastContactedAt: new Date(),
      nextFollowUpAt: null,
      ...overrides,
    },
    recentMessages: [
      { direction: 'OUTBOUND', content: 'Hola Carlos, vi tu anuncio.', sentAt: new Date(1) },
      { direction: 'INBOUND', content: '¿Cómo se integra con Guesty?', sentAt: new Date(2) },
    ],
    channel: { name: 'airbnb', locale: 'es-CO', constraints: [] },
  }
}

describe('lastInboundMessage', () => {
  it('returns the most recent inbound message', () => {
    const msg = lastInboundMessage(makeContext())
    assert.equal(msg?.content, '¿Cómo se integra con Guesty?')
  })
})

describe('isKillSwitchTriggered', () => {
  it('is false before sending the cal link', () => {
    assert.equal(isKillSwitchTriggered(makeContext({ calLinkSent: false, botReplyCount: 5 })), false)
  })

  it('is true once the link was sent and the bot reply limit is reached', () => {
    assert.equal(isKillSwitchTriggered(makeContext({ calLinkSent: true, botReplyCount: 2 })), true)
  })

  it('is false when under the limit', () => {
    assert.equal(isKillSwitchTriggered(makeContext({ calLinkSent: true, botReplyCount: 1 })), false)
  })
})

describe('buildBriefing', () => {
  it('detects the active topic from the last inbound message', () => {
    const briefing = buildBriefing(makeContext())
    assert.equal(briefing.activeTopic, 'integraciones')
  })

  it('flags the cal link as already sent and kill switch imminent', () => {
    const briefing = buildBriefing(makeContext({ calLinkSent: true, botReplyCount: 1 }))
    assert.equal(briefing.calLinkAlreadySent, true)
    assert.equal(briefing.killSwitchImminent, true)
  })

  it('does not flag kill switch when link not sent', () => {
    const briefing = buildBriefing(makeContext({ calLinkSent: false, botReplyCount: 5 }))
    assert.equal(briefing.killSwitchImminent, false)
  })
})
