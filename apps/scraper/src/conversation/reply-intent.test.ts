import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { classifyHostReply, isMeetingAffirmative } from './reply-intent'

describe('classifyHostReply — rechazo', () => {
  const rejections = [
    'No',
    'No.',
    'NO',
    'Nope',
    'Nel',
    'No gracias, no me interesa.',
    'Paso, gracias.',
    'No por ahora',
    'Ahora no, gracias',
    'Gracias igual',
    'Todo bien, gracias',
    'Ya tengo un sistema para eso',
    'No me escribas más por favor',
    'Not interested',
    'No, gracias',
    'Prefiero no, gracias',
    'De momento no',
    'Gracias pero no esta disponible',
  ]

  for (const text of rejections) {
    it(`rechaza: "${text}"`, () => {
      assert.equal(classifyHostReply(text).intent, 'rejected', text)
    })
  }
})

describe('classifyHostReply — interés', () => {
  const interests = [
    'Dale, cuéntame más',
    'Comentame como funciona',
    'Suena interesante, ¿qué es?',
    'Sí, tengo 5 minutos',
    'Adelante, cuéntame en qué consiste',
    'A ver, háblame más',
    'Me gustaría saber cómo funciona',
    'Mándame más info por favor',
    'Cuánto cuesta?',
    'Tell me more',
    'Claro que sí, coméntame',
    'Hola buenas tardes, claro que sí, cuéntame',
    'Bacano, explícame',
    'Charlemos, suena chevere',
    // Secas de industria (= quiere escuchar)
    'Si',
    'Sí',
    'OK',
    'Ok',
    'Hola',
    'Hola Michell',
    'Buenas',
    'Recibido',
    'Entendido',
    'Bien',
    'No sé',
  ]

  for (const text of interests) {
    it(`interés: "${text}"`, () => {
      assert.equal(classifyHostReply(text).intent, 'interested', text)
    })
  }

  it('tags bare Si as si_solo', () => {
    assert.equal(classifyHostReply('Si').matchedPattern, 'si_solo')
  })

  it('tags unknown dry reply as dry_default_listen', () => {
    assert.equal(classifyHostReply('Mmm ya veo').intent, 'interested')
    assert.equal(classifyHostReply('Mmm ya veo').matchedPattern, 'dry_default_listen')
  })
})

describe('classifyHostReply — prioridad y vacío', () => {
  it('rejection wins over interest when both could match', () => {
    assert.equal(classifyHostReply('No gracias, pero suena interesante').intent, 'rejected')
  })

  it('empty text stays ambiguous (no auto-reply)', () => {
    assert.equal(classifyHostReply('').intent, 'ambiguous')
    assert.equal(classifyHostReply('   ').intent, 'ambiguous')
  })

  it('ok gracias is treated as soft rejection', () => {
    assert.equal(classifyHostReply('Ok gracias').intent, 'rejected')
  })

  it('bare No is rejection, not interest', () => {
    assert.equal(classifyHostReply('No').intent, 'rejected')
    assert.equal(classifyHostReply('No').matchedPattern, 'no_solo')
  })
})

describe('isMeetingAffirmative', () => {
  const meetings = [
    'Sí, mañana me parece bien',
    'Agendemos una llamada',
    'Confirmo, hablamos mañana a las 10am',
    'De acuerdo, hagámoslo',
    'Estoy disponible en la tarde',
  ]

  for (const text of meetings) {
    it(`reunión: "${text}"`, () => {
      assert.equal(isMeetingAffirmative(text), true, text)
    })
  }

  it('does not match plain interest', () => {
    assert.equal(isMeetingAffirmative('Dale, cuéntame más'), false)
  })

  it('does not treat reservation UI timestamps as meeting acceptance', () => {
    assert.equal(
      isMeetingAffirmative(
        'Consulta enviadaMedellín City Stay | Near Everything16 – 17 de jul de 2026 · 1 huésped',
      ),
      false,
    )
    assert.equal(
      isMeetingAffirmative(
        'Reservación pendienteBello Apartaestudio 24 – 25 de jul de 2026 Tienes hasta el 24 jul',
      ),
      false,
    )
  })
})
