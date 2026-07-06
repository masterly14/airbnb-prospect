import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildHandoffEmail,
  resolveDashboardLeadUrl,
  truncateText,
  type HandoffContext,
} from './handoff-email'

const baseContext: HandoffContext = {
  lead: {
    id: 'lead-uuid-123',
    name: 'María García',
    hostAirbnbId: 'host-999',
    hostProfileUrl: 'https://www.airbnb.com.co/users/show/999',
    threadId: 'https://www.airbnb.com.co/guest/messages/thread-abc',
    totalProperties: 15,
    market: 'Medellín',
  },
  lastInboundMessage: 'Sí, agendemos mañana a las 10am',
  prospectAccount: {
    label: 'Cuenta 1',
    airbnbEmail: 'prospect1@example.com',
  },
  reason: 'Host aceptó reunión tras mensaje de curiosidad',
}

describe('buildHandoffEmail', () => {
  beforeEach(() => {
    process.env.APP_URL = 'https://app.example.com'
    delete process.env.DASHBOARD_URL
  })

  afterEach(() => {
    delete process.env.APP_URL
    delete process.env.DASHBOARD_URL
  })

  it('builds subject with name, properties and market', () => {
    const { subject } = buildHandoffEmail(baseContext)
    assert.equal(subject, '[Handoff] María García — 15 props — Medellín')
  })

  it('includes all required body fields', () => {
    const { text } = buildHandoffEmail(baseContext)

    assert.match(text, /Lead ID: lead-uuid-123/)
    assert.match(text, /Host Airbnb ID: host-999/)
    assert.match(text, /Perfil: https:\/\/www\.airbnb\.com\.co\/users\/show\/999/)
    assert.match(text, /Thread: https:\/\/www\.airbnb\.com\.co\/guest\/messages\/thread-abc/)
    assert.match(text, /Sí, agendemos mañana a las 10am/)
    assert.match(text, /Cuenta 1 \(prospect1@example\.com\)/)
    assert.match(text, /Host aceptó reunión/)
    assert.match(text, /https:\/\/app\.example\.com\/pipeline\?leadId=lead-uuid-123/)
  })

  it('uses fallbacks when thread, account and market are missing', () => {
    const { subject, text } = buildHandoffEmail({
      ...baseContext,
      lead: {
        ...baseContext.lead,
        threadId: null,
        market: null,
      },
      lastInboundMessage: null,
      prospectAccount: null,
    })

    assert.match(subject, /sin mercado/)
    assert.match(text, /Thread: no disponible/)
    assert.match(text, /no disponible/)
    assert.match(text, /Cuenta de prospección ---\ndesconocida/)
  })
})

describe('resolveDashboardLeadUrl', () => {
  afterEach(() => {
    delete process.env.APP_URL
    delete process.env.DASHBOARD_URL
  })

  it('prefers DASHBOARD_URL over APP_URL', () => {
    process.env.DASHBOARD_URL = 'https://dashboard.example.com/'
    process.env.APP_URL = 'https://app.example.com'
    assert.equal(
      resolveDashboardLeadUrl('abc'),
      'https://dashboard.example.com/pipeline?leadId=abc',
    )
  })

  it('defaults to localhost when env is unset', () => {
    assert.equal(
      resolveDashboardLeadUrl('abc'),
      'http://localhost:3000/pipeline?leadId=abc',
    )
  })
})

describe('truncateText', () => {
  it('truncates long inbound previews', () => {
    const long = 'a'.repeat(600)
    const result = truncateText(long, 500)
    assert.equal(result.length, 501)
    assert.ok(result.endsWith('…'))
  })
})
