import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyPolicy,
  enforceSingleQuestion,
  includesCalLink,
  removeCalLinkSentences,
  sanitize,
  stripHttps,
  stripMarkdown,
} from './response-policy.js'

describe('stripHttps', () => {
  it('removes the protocol but keeps the cal.com link intact', () => {
    assert.equal(stripHttps('Agenda en https://cal.com/agent-pilot'), 'Agenda en cal.com/agent-pilot')
  })
})

describe('enforceSingleQuestion', () => {
  it('keeps at most one question', () => {
    const out = enforceSingleQuestion('¿Tienes tiempo? Cuéntame. ¿Te sirve mañana?')
    const questionMarks = (out.match(/\?/g) ?? []).length
    assert.equal(questionMarks, 1)
  })

  it('does not break cal.com links (no false sentence split)', () => {
    const out = enforceSingleQuestion('Te ayudo con eso. Agenda en cal.com/agent-pilot cuando quieras.')
    assert.match(out, /cal\.com\/agent-pilot/)
  })
})

describe('sanitize', () => {
  it('removes UUIDs and internal jargon', () => {
    const dirty = 'Segun mi prompt, el lead status del leadId 123e4567-e89b-12d3-a456-426614174000 cambia.'
    const clean = sanitize(dirty)
    assert.doesNotMatch(clean, /123e4567-e89b-12d3-a456-426614174000/)
    assert.doesNotMatch(clean, /lead status/i)
    assert.doesNotMatch(clean, /leadId/)
  })
})

describe('stripMarkdown', () => {
  it('removes bold markers and bullet lists', () => {
    const out = stripMarkdown('**Hola**\n- punto uno\n- punto dos')
    assert.doesNotMatch(out, /\*\*/)
    assert.doesNotMatch(out, /^- /m)
  })
})

describe('removeCalLinkSentences', () => {
  it('drops only the sentence with the link', () => {
    const out = removeCalLinkSentences('Esto te ahorra tiempo. Agenda en cal.com/agent-pilot. Saludos.')
    assert.doesNotMatch(out, /cal\.com/)
    assert.match(out, /ahorra tiempo/)
    assert.match(out, /Saludos/)
  })
})

describe('applyPolicy', () => {
  it('blocks the cal link when not the due moment (cold)', () => {
    const result = applyPolicy(
      'Hola, te ayudamos con la operación. Agenda en https://cal.com/agent-pilot.',
      { allowCalLink: false },
    )
    assert.equal(result.includesCalLink, false)
    assert.equal(result.removedCalLink, true)
  })

  it('keeps the cal link when allowed and strips https', () => {
    const result = applyPolicy(
      'Con gusto te muestro cómo funciona. Agenda en https://cal.com/agent-pilot.',
      { allowCalLink: true },
    )
    assert.equal(result.includesCalLink, true)
    assert.doesNotMatch(result.text, /https:\/\//)
    assert.match(result.text, /cal\.com\/agent-pilot/)
  })

  it('enforces a single question', () => {
    const result = applyPolicy('¿Te interesa? ¿O prefieres que te escriba luego?', {
      allowCalLink: false,
    })
    const questionMarks = (result.text.match(/\?/g) ?? []).length
    assert.equal(questionMarks, 1)
  })
})

describe('includesCalLink', () => {
  it('detects cal.com case-insensitively', () => {
    assert.equal(includesCalLink('CAL.COM/agent-pilot'), true)
    assert.equal(includesCalLink('no link here'), false)
  })
})
