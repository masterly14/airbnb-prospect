import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildManualSessionEmailText,
  buildVerifyAccountCommand,
  classifyManualSessionReason,
} from './manual-session-remediation'

describe('classifyManualSessionReason', () => {
  it('detects Arkose / security verification', () => {
    assert.equal(
      classifyManualSessionReason(
        new Error('Timeout esperando que resuelvas la Verificación de seguridad de Airbnb'),
      ),
      'captcha',
    )
    assert.equal(
      classifyManualSessionReason(new Error('Airbnb pidió "Verificación de seguridad" (Arkose).')),
      'captcha',
    )
  })

  it('detects guest header / failed login', () => {
    assert.equal(
      classifyManualSessionReason(
        new Error('Login falló: el header sigue mostrando "Iniciar sesión o registrarse"'),
      ),
      'login_failed',
    )
  })

  it('detects session expired', () => {
    assert.equal(
      classifyManualSessionReason(new Error('HarvestSessionExpiredError')),
      'session_expired',
    )
  })

  it('returns null for unrelated errors', () => {
    assert.equal(classifyManualSessionReason(new Error('network timeout 503')), null)
  })
})

describe('buildManualSessionEmailText', () => {
  it('includes command and recipient-facing instructions', () => {
    const { subject, text } = buildManualSessionEmailText({
      label: 'Legacy',
      airbnbEmail: 'svaron066@gmail.com',
      accountId: 'acc-1',
      reason: 'captcha',
      message: 'Verificación de seguridad',
      job: 'login',
      proxyHost: 'gate.decodo.com',
      proxyPort: 10003,
    })

    assert.match(subject, /Acción requerida/)
    assert.match(subject, /Legacy/)
    assert.match(text, /svaron066@gmail.com/)
    assert.match(text, /gate\.decodo\.com:10003/)
    assert.match(text, /auth:verify-account/)
    assert.match(text, /--headed/)
    assert.equal(
      buildVerifyAccountCommand('santiagoairbnbp1@gmail.com'),
      'npm run auth:verify-account -- --email santiagoairbnbp1@gmail.com --headed',
    )
  })
})
