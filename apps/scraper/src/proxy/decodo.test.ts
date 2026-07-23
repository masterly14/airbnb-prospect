import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  DECODO_DEFAULTS,
  buildDecodoProxyCredentials,
  buildDecodoUsername,
  normalizeDecodoBaseUsername,
  parseDecodoUsername,
  readDecodoEnv,
  resolveDecodoSessionId,
  resolveDecodoStickyPort,
} from './decodo'

describe('decodo sticky helpers', () => {
  it('normalizes user- prefix and full dashboard username paste', () => {
    assert.equal(normalizeDecodoBaseUsername('user-sp12345'), 'sp12345')
    assert.equal(normalizeDecodoBaseUsername('sp12345'), 'sp12345')
    assert.equal(
      normalizeDecodoBaseUsername('user-sp12345-sessionduration-60'),
      'sp12345',
    )
  })

  it('builds port-mode username like the Decodo dashboard curl', () => {
    const user = buildDecodoUsername({
      username: 'sp12345',
      stickyMode: 'port',
      sessionDurationMinutes: 60,
      country: null,
    })
    assert.equal(user, 'user-sp12345-sessionduration-60')
  })

  it('builds session-mode username with country and session id', () => {
    const user = buildDecodoUsername({
      username: 'sp12345',
      stickyMode: 'session',
      sessionId: 'legacy01',
      country: 'co',
      sessionDurationMinutes: 1440,
    })
    assert.equal(
      user,
      'user-sp12345-country-co-session-legacy01-sessionduration-1440',
    )
  })

  it('assigns sequential sticky ports', () => {
    assert.equal(resolveDecodoStickyPort(0), 10001)
    assert.equal(resolveDecodoStickyPort(1), 10002)
    assert.equal(resolveDecodoStickyPort(2, 10001), 10003)
  })

  it('builds port-mode credentials for Playwright fields', () => {
    const creds = buildDecodoProxyCredentials({
      username: 'user-sp12345',
      password: 'secret',
      sessionId: '10001',
      stickyMode: 'port',
      country: null,
      sessionDurationMinutes: 60,
    })
    assert.equal(creds.provider, 'decodo')
    assert.equal(creds.host, DECODO_DEFAULTS.host)
    assert.equal(creds.port, 10001)
    assert.equal(creds.user, 'user-sp12345-sessionduration-60')
    assert.equal(creds.pass, 'secret')
  })

  it('reuses stored session id and derives a stable one otherwise', () => {
    assert.equal(
      resolveDecodoSessionId({
        id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        label: 'Legacy',
        proxySessionId: 'keep-me',
      }),
      'keep-me',
    )

    const derived = resolveDecodoSessionId({
      id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      label: 'Cuenta Michell',
      proxySessionId: null,
    })
    assert.equal(derived, 'cuentamichellaaaaaaaa')
  })

  it('parses session/country/duration from username', () => {
    const parsed = parseDecodoUsername(
      'user-sp12345-country-co-session-legacy01-sessionduration-90',
    )
    assert.equal(parsed.baseUsername, 'sp12345')
    assert.equal(parsed.country, 'co')
    assert.equal(parsed.sessionId, 'legacy01')
    assert.equal(parsed.sessionDurationMinutes, 90)
  })

  it('reads env config for port sticky mode matching the dashboard', () => {
    const cfg = readDecodoEnv({
      DECODO_USERNAME: 'sp99',
      DECODO_PASSWORD: 'pw',
      DECODO_STICKY_MODE: 'port',
      DECODO_SESSION_DURATION_MINUTES: '60',
      DECODO_COUNTRY: 'random',
    })
    assert.equal(cfg.username, 'sp99')
    assert.equal(cfg.stickyMode, 'port')
    assert.equal(cfg.sessionDurationMinutes, 60)
    assert.equal(cfg.country, null)
    assert.equal(cfg.stickyPortStart, 10001)

    assert.throws(() => readDecodoEnv({}), /DECODO_USERNAME/)
  })
})
