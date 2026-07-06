import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildCalComLinkForLead, getCalComBaseLink } from './cal-link'

describe('buildCalComLinkForLead', () => {
  it('appends metadata leadId query param', () => {
    const link = buildCalComLinkForLead('abc-123')
    assert.match(link, /cal\.com/)
    assert.match(link, /metadata\[leadId\]=abc-123/)
  })

  it('uses ampersand when base link already has query params', () => {
    const original = process.env.CAL_COM_LINK
    process.env.CAL_COM_LINK = 'cal.com/agent-pilot/diagnostico?foo=bar'

    try {
      const link = buildCalComLinkForLead('lead-99')
      assert.match(link, /\?foo=bar&metadata\[leadId\]=lead-99/)
    } finally {
      if (original === undefined) delete process.env.CAL_COM_LINK
      else process.env.CAL_COM_LINK = original
    }
  })

  it('getCalComBaseLink strips https', () => {
    const original = process.env.CAL_COM_LINK
    process.env.CAL_COM_LINK = 'https://cal.com/agent-pilot/diagnostico'

    try {
      assert.equal(getCalComBaseLink(), 'cal.com/agent-pilot/diagnostico')
    } finally {
      if (original === undefined) delete process.env.CAL_COM_LINK
      else process.env.CAL_COM_LINK = original
    }
  })
})
