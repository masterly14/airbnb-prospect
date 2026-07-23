import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { looksLikeSecurityChallenge } from './security-challenge'

describe('looksLikeSecurityChallenge', () => {
  it('detects Spanish Arkose modal copy', () => {
    assert.equal(
      looksLikeSecurityChallenge(
        'Verificación de seguridad\nAlgo ha salido mal. Vuelva a cargar el desafío e inténtelo de nuevo.\nRecargar desafío',
      ),
      true,
    )
  })

  it('ignores normal Airbnb copy', () => {
    assert.equal(looksLikeSecurityChallenge('Alojamientos en Lisboa'), false)
  })
})
