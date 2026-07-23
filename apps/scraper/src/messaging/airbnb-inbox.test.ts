import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyMessageDirection,
  deriveHostNameFromInboxPreview,
  parseInboxListThreadId,
} from '../messaging/airbnb-inbox'
import { isTravelerInboxFilterLabel } from '../messaging/inbox-navigation'

describe('isTravelerInboxFilterLabel', () => {
  it('detects Spanish traveler filter label', () => {
    assert.equal(isTravelerInboxFilterLabel('Modo viajero'), true)
  })

  it('detects English traveler filter label', () => {
    assert.equal(isTravelerInboxFilterLabel('Traveler mode'), true)
  })

  it('rejects host/all filters', () => {
    assert.equal(isTravelerInboxFilterLabel('Todos'), false)
    assert.equal(isTravelerInboxFilterLabel('Anfitrión'), false)
  })
})

describe('parseInboxListThreadId', () => {
  it('extracts numeric thread id from inbox_list test id', () => {
    assert.equal(parseInboxListThreadId('inbox_list_123456789'), '123456789')
  })

  it('returns null for unrelated test ids', () => {
    assert.equal(parseInboxListThreadId('inbox-container-marker'), null)
    assert.equal(parseInboxListThreadId('inbox_list_abc'), null)
  })
})

describe('deriveHostNameFromInboxPreview', () => {
  it('extracts host name from Spanish inbox preview', () => {
    const text =
      'Leído Conversación con Roció. El último mensaje que se envío el jue. es este: Tú: Hola'
    assert.equal(deriveHostNameFromInboxPreview(text), 'Roció')
  })

  it('extracts multi-name conversation title', () => {
    const text =
      'Leído Conversación con Sebastian, Santiago, Lisseth. El último mensaje que se envió'
    assert.equal(deriveHostNameFromInboxPreview(text), 'Sebastian, Santiago, Lisseth')
  })
})

describe('classifyMessageDirection', () => {
  it('classifies self markers as OUTBOUND', () => {
    assert.equal(classifyMessageDirection('Tú: Hola, gracias', 'Ana García'), 'OUTBOUND')
    assert.equal(classifyMessageDirection('You: Thanks', 'John'), 'OUTBOUND')
  })

  it('classifies host name prefix as INBOUND', () => {
    assert.equal(
      classifyMessageDirection('Ana: Sí, me interesa', 'Ana García'),
      'INBOUND',
    )
  })

  it('defaults to INBOUND without self marker', () => {
    assert.equal(
      classifyMessageDirection('¿De qué trata esto?', 'Carlos'),
      'INBOUND',
    )
  })
})
