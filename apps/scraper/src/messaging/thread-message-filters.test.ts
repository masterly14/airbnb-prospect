import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  extractHostReplyFromInboxPreview,
  isAirbnbThreadNoise,
  isOutboundTemplateEcho,
  lastHostReplyForTurn,
  lastMeaningfulInbound,
  normalizeScrapedHostBubble,
} from '../messaging/thread-message-filters'

describe('isAirbnbThreadNoise', () => {
  it('flags Airbnb system copy', () => {
    assert.equal(isAirbnbThreadNoise('Consulta enviada · 16 – 18 de jul · Bogotá'), true)
    assert.equal(isAirbnbThreadNoise('Se envió tu consulta para 1 huésped el 16 – 18 de jul.'), true)
    assert.equal(isAirbnbThreadNoise('Reservar'), true)
  })

  it('flags reservation invitation / status UI', () => {
    assert.equal(
      isAirbnbThreadNoise(
        'Invitación para reservar. El estado de la reservación es Te invitamos a hacer una reservación. Reservación del 24 jul al 25 jul en Bogotá.',
      ),
      true,
    )
    assert.equal(
      isAirbnbThreadNoise(
        'Tú: Consulta enviada. El estado de la reservación es Consulta enviada. Reservación del 24 jul al 25 jul en Bogotá.',
      ),
      true,
    )
    assert.equal(isAirbnbThreadNoise('Te invitamos a hacer una reservación · 25 – 27 de jul · Bogotá'), true)
    assert.equal(isAirbnbThreadNoise('Reserva una oferta especial'), true)
  })

  it('flags concatenated reservation UI that previously triggered false curiosity', () => {
    assert.equal(
      isAirbnbThreadNoise(
        'Consulta enviadaLoft Piso 1402 – Vista y Ubicación IdealLeído por Aleja y The Concept Group Host',
      ),
      true,
    )
    assert.equal(isAirbnbThreadNoise('Nueva solicitud de reservación'), true)
    assert.equal(isAirbnbThreadNoise('Estadía en curso · 23 – 24 de jul · 404 William nikko'), true)
    assert.equal(isAirbnbThreadNoise('Confirmada · 26 – 28 de jul · 201 Mauricio Nikko'), true)
    assert.equal(
      isAirbnbThreadNoise(
        'Consulta enviadaDos ambientes moderno con balcón 50523 – 24 de jul de 2026 · 1 huéspedEl anfitrión dispone de 24 horas para responderte.',
      ),
      true,
    )
    assert.equal(
      isAirbnbThreadNoise(
        'The Concept Group Host · Anfitrión16:27Reservación pendienteLoft Piso 1402 – Vista y Ubicación Ideal23 – 24 de jul de 2026 · 1 huéspedTienes hasta el 24 jul, 2:27 p.m. GMT-7 para responder.Completa la reservación',
      ),
      true,
    )
  })

  it('flags name-only UI snippets', () => {
    assert.equal(isAirbnbThreadNoise('Elizabeth, Catalina'), true)
    assert.equal(isAirbnbThreadNoise('Miguel Angel, Maria Fernanda, Julio Cesar'), true)
  })

  it('keeps real host replies', () => {
    assert.equal(isAirbnbThreadNoise('Dale, cuéntame más'), false)
    assert.equal(isAirbnbThreadNoise('Gracias, no requerimos en el momento.'), false)
    assert.equal(isAirbnbThreadNoise('¿Cómo funciona con las limpiezas?'), false)
    assert.equal(isAirbnbThreadNoise('Si'), false)
    assert.equal(isAirbnbThreadNoise('Hola Michell'), false)
  })
})

describe('normalizeScrapedHostBubble', () => {
  it('returns null for reservation UI', () => {
    assert.equal(normalizeScrapedHostBubble('Confirmada · 26 – 28 de jul · 201 Mauricio Nikko'), null)
    assert.equal(normalizeScrapedHostBubble('Nueva solicitud de reservación'), null)
  })

  it('extracts real speech from Anfitrión header bubbles', () => {
    assert.equal(
      normalizeScrapedHostBubble('Felipe · Anfitrión9:18Buenos días 😃 Leído por Gabriela'),
      'Buenos días 😃',
    )
    assert.equal(
      normalizeScrapedHostBubble('Eliana Maria · Coanfitrión16:28Buenas tardes'),
      'Buenas tardes',
    )
    assert.equal(
      normalizeScrapedHostBubble('Luis · Anfitrión8:23Hola Michell'),
      'Hola Michell',
    )
  })
})

describe('isOutboundTemplateEcho', () => {
  it('detects cold message echoed in scrape', () => {
    assert.equal(
      isOutboundTemplateEcho(
        '¡Hola Sandra! Noté que eres superanfitriona. Hemos implementado en Property Managers como tu un sistema',
      ),
      true,
    )
  })
})

describe('lastMeaningfulInbound', () => {
  it('skips noise and picks the last real host message', () => {
    const messages = [
      { direction: 'OUTBOUND', content: 'Hola Sandra...' },
      { direction: 'INBOUND', content: 'Dale, cuéntame más' },
      { direction: 'INBOUND', content: 'Elizabeth, Catalina' },
      { direction: 'INBOUND', content: 'Consulta enviada · 16 – 18 de jul · Bogotá' },
    ]
    const last = lastMeaningfulInbound(messages)
    assert.equal(last?.content, 'Dale, cuéntame más')
  })

  it('skips reservation invite and keeps short affirmative', () => {
    const messages = [
      { direction: 'OUTBOUND', content: '¡Hola Luis! Noté que eres superanfitrión...', aiIntent: 'PHASE_1_COLD' },
      { direction: 'INBOUND', content: 'Hola Michell' },
      { direction: 'INBOUND', content: 'Si' },
      {
        direction: 'INBOUND',
        content:
          'Invitación para reservar. El estado de la reservación es Te invitamos a hacer una reservación. Reservación del 24 jul al 25 jul en Bogotá.',
      },
    ]
    assert.equal(lastMeaningfulInbound(messages)?.content, 'Si')
  })

  it('ignores simulated dry-run inbounds', () => {
    const messages = [
      { direction: 'OUTBOUND', content: 'Hola', aiIntent: 'PHASE_1_COLD' },
      {
        direction: 'INBOUND',
        content: 'Dale, cuéntame más',
        aiIntent: 'SIMULATED_DRY_RUN',
      },
      { direction: 'INBOUND', content: 'No' },
    ]
    assert.equal(lastMeaningfulInbound(messages)?.content, 'No')
  })
})

describe('lastHostReplyForTurn', () => {
  it('uses host reply between cold and curiosity', () => {
    const messages = [
      { direction: 'OUTBOUND', content: 'Hola', aiIntent: 'PHASE_1_COLD' },
      { direction: 'INBOUND', content: 'No' },
      {
        direction: 'OUTBOUND',
        content: 'Excelente, te comento!',
        aiIntent: 'CURIOSITY_REPLY',
      },
    ]
    assert.equal(lastHostReplyForTurn(messages)?.content, 'No')
  })
})

describe('extractHostReplyFromInboxPreview', () => {
  it('extracts Miguel Angel reply from preview', () => {
    const raw =
      'Miguel Angel, Maria Fernanda 13:16 Miguel Angel: Hola buenas tardes, claro que sí, cuéntame · Consulta enviada'
    assert.equal(
      extractHostReplyFromInboxPreview(raw, 'Miguel Angel'),
      'Hola buenas tardes, claro que sí, cuéntame',
    )
  })
})
