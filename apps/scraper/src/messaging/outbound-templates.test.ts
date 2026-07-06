import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { LeadStatus } from '@repo/db'
import {
  buildCuriosityReplyMessage,
  buildOutboundMessage,
  buildTemplateVars,
  getCalComLink,
  resolveSuperhostTitle,
} from '../messaging/outbound-templates'
import { phaseForStatus } from '../persistence/outbound-pipeline'

const sampleLead = {
  id: 'lead-1',
  hostAirbnbId: '12345',
  threadId: null,
  name: 'Ana García',
  hostProfileUrl: 'https://www.airbnb.com.co/users/show/12345',
  primaryListingUrl: 'https://www.airbnb.com.co/rooms/999',
  primaryListingName: 'Loft Centro',
  totalProperties: 15,
  companyName: null,
  isSuperhost: true,
  market: 'Bogotá',
  icpSkipReason: null,
  status: LeadStatus.LEAD_DISCOVERED,
  businessScale: null,
  painPoints: null,
  executiveSummary: null,
  lastContactedAt: null,
  nextFollowUpAt: null,
  botReplyCount: 0,
  calLinkSent: false,
  calBookedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}

describe('outbound templates', () => {
  it('phase 1 cold uses superanfitriona for Ana and new copy', () => {
    const message = buildOutboundMessage(sampleLead, 'PHASE_1_COLD')
    assert.match(message, /^¡Hola Ana! Noté que eres superanfitriona\./)
    assert.match(message, /100 horas semanales/)
    assert.match(message, /¿Tienes 5 minutos/)
    assert.equal(message.toLowerCase().includes('cal.com'), false)
  })

  it('phase 1 cold uses superanfitrión for Andrés', () => {
    const lead = { ...sampleLead, name: 'Andrés López' }
    const message = buildOutboundMessage(lead, 'PHASE_1_COLD')
    assert.match(message, /superanfitrión/)
  })

  it('resolveSuperhostTitle respects explicit gender', () => {
    assert.equal(resolveSuperhostTitle('Ana', 'female'), 'superanfitriona')
    assert.equal(resolveSuperhostTitle('Andrés', 'male'), 'superanfitrión')
  })

  it('curiosity reply is static and mentions platform', () => {
    const message = buildCuriosityReplyMessage(sampleLead)
    assert.match(message, /^Excelente, te comento!/)
    assert.match(message, /guest-report y finanzas/)
    assert.match(message, /10-15 min mañana/)
    assert.equal(message.toLowerCase().includes('cal.com'), false)
  })

  it('follow-up phases do not include cal.com', () => {
    for (const phase of ['PHASE_2_OPS', 'PHASE_3_BI', 'PHASE_4_BREAKUP'] as const) {
      const message = buildOutboundMessage(sampleLead, phase)
      assert.equal(message.toLowerCase().includes('cal.com'), false)
    }
  })

  it('buildTemplateVars extracts first name and superhost title', () => {
    const vars = buildTemplateVars(sampleLead)
    assert.equal(vars.name, 'Ana')
    assert.equal(vars.superhostTitle, 'superanfitriona')
  })

  it('phaseForStatus maps discovery to cold template', () => {
    const phase = phaseForStatus(LeadStatus.LEAD_DISCOVERED)
    assert.equal(phase, 'PHASE_1_COLD')
    const message = buildOutboundMessage(sampleLead, phase!)
    assert.match(message, /Property Managers como tu/)
  })

  it('blocks cold outbound for non-superhost leads', () => {
    const lead = { ...sampleLead, isSuperhost: false }
    assert.throws(
      () => buildOutboundMessage(lead, 'PHASE_1_COLD'),
      /does not meet ICP requirements/,
    )
  })

  it('getCalComLink strips https', () => {
    const link = getCalComLink()
    assert.equal(link.startsWith('https://'), false)
    assert.match(link, /cal\.com/)
  })
})
