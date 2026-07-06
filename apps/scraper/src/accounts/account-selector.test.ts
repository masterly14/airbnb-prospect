import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { AccountStatus, type ProspectAccount } from '@repo/db'
import {
  accountCanEstablishSession,
  accountNextAvailableAt,
  getDailyMessageCap,
  isAccountEligibleForPick,
  nextColombiaMidnightUtc,
  sortAccountsForPick,
} from './account-selector'
import { OPERATIONS } from '../discovery/icp'

function makeAccount(
  partial: Partial<ProspectAccount> & Pick<ProspectAccount, 'id' | 'label' | 'airbnbEmail'>,
): ProspectAccount {
  const now = new Date('2026-07-04T12:00:00Z')
  return {
    composioUserId: null,
    composioConnectionId: null,
    composioConnectedAt: null,
    airbnbPasswordEnc: null,
    proxyHost: null,
    proxyPort: null,
    proxyUser: null,
    proxyPassEnc: null,
    sessionPath: 'playwright/.auth/account-test.json',
    sessionStateEnc: null,
    market: 'Bogotá',
    messagesSentToday: 0,
    waveMessagesSent: 0,
    status: AccountStatus.ACTIVE,
    rateLimitedAt: null,
    cooldownUntil: null,
    lastWaveStartedAt: null,
    createdAt: now,
    updatedAt: now,
    ...partial,
  }
}

describe('account selector', () => {
  const now = new Date('2026-07-04T12:00:00Z')

  it('excludes blocked and pending accounts', () => {
    assert.equal(
      isAccountEligibleForPick(makeAccount({ id: '1', label: 'A', airbnbEmail: 'a@test.com', status: AccountStatus.BLOCKED }), now),
      false,
    )
    assert.equal(
      isAccountEligibleForPick(
        makeAccount({ id: '2', label: 'B', airbnbEmail: 'b@test.com', status: AccountStatus.PENDING_CREDENTIALS }),
        now,
      ),
      false,
    )
  })

  it('caps daily throughput at waves-per-day target', () => {
    assert.equal(getDailyMessageCap(), OPERATIONS.MSGS_PER_WAVE * OPERATIONS.WAVES_PER_DAY_TARGET)

    const atCap = makeAccount({
      id: 'cap',
      label: 'Cap',
      airbnbEmail: 'cap@test.com',
      messagesSentToday: getDailyMessageCap(),
    })
    assert.equal(isAccountEligibleForPick(atCap, now), false)

    const underCap = makeAccount({
      id: 'under',
      label: 'Under',
      airbnbEmail: 'under@test.com',
      messagesSentToday: getDailyMessageCap() - 1,
    })
    assert.equal(isAccountEligibleForPick(underCap, now), true)
  })

  it('excludes accounts without a session nor credentials to auto-login', () => {
    const noSession = makeAccount({
      id: 'ns',
      label: 'NoSession',
      airbnbEmail: 'ns@test.com',
      sessionPath: null,
    })
    assert.equal(isAccountEligibleForPick(noSession, now), false)
  })

  it('is eligible via a DB session blob even without a session path', () => {
    const dbSession = makeAccount({
      id: 'dbsess',
      label: 'DbSession',
      airbnbEmail: 'dbsess@test.com',
      sessionPath: null,
      sessionStateEnc: 'enc-blob',
    })
    assert.equal(accountCanEstablishSession(dbSession), true)
    assert.equal(isAccountEligibleForPick(dbSession, now), true)
  })

  it('is eligible via credentials (auto-login) with no session yet', () => {
    const freshWithCreds = makeAccount({
      id: 'creds',
      label: 'Creds',
      airbnbEmail: 'creds@test.com',
      sessionPath: null,
      sessionStateEnc: null,
      airbnbPasswordEnc: 'enc-pass',
      composioConnectionId: 'conn_123',
    })
    assert.equal(accountCanEstablishSession(freshWithCreds), true)
    assert.equal(isAccountEligibleForPick(freshWithCreds, now), true)
  })

  it('excludes accounts without a market', () => {
    const noMarket = makeAccount({
      id: 'nm',
      label: 'NoMarket',
      airbnbEmail: 'nm@test.com',
      market: null,
    })
    assert.equal(isAccountEligibleForPick(noMarket, now), false)
  })

  it('excludes accounts in active cooldown', () => {
    assert.equal(
      isAccountEligibleForPick(
        makeAccount({
          id: '3',
          label: 'C',
          airbnbEmail: 'c@test.com',
          status: AccountStatus.COOLDOWN,
          cooldownUntil: new Date('2026-07-04T18:00:00Z'),
        }),
        now,
      ),
      false,
    )
  })

  it('picks account with lowest waveMessagesSent first', () => {
    const accounts = sortAccountsForPick([
      makeAccount({ id: 'a', label: 'A', airbnbEmail: 'a@test.com', waveMessagesSent: 7 }),
      makeAccount({ id: 'b', label: 'B', airbnbEmail: 'b@test.com', waveMessagesSent: 2 }),
      makeAccount({
        id: 'c',
        label: 'C',
        airbnbEmail: 'c@test.com',
        status: AccountStatus.COOLDOWN,
        cooldownUntil: new Date('2026-07-04T10:00:00Z'),
        waveMessagesSent: 0,
      }),
    ])

    assert.equal(accounts[0].id, 'c')
    assert.equal(accounts[1].id, 'b')
  })

  it('simulates rotation skipping cooldown account among five', () => {
    const candidates = [
      makeAccount({ id: '1', label: '1', airbnbEmail: '1@test.com', waveMessagesSent: 3 }),
      makeAccount({ id: '2', label: '2', airbnbEmail: '2@test.com', waveMessagesSent: 1 }),
      makeAccount({
        id: '3',
        label: '3',
        airbnbEmail: '3@test.com',
        status: AccountStatus.COOLDOWN,
        cooldownUntil: new Date('2026-07-04T18:00:00Z'),
        waveMessagesSent: 0,
      }),
      makeAccount({ id: '4', label: '4', airbnbEmail: '4@test.com', waveMessagesSent: 5 }),
      makeAccount({ id: '5', label: '5', airbnbEmail: '5@test.com', waveMessagesSent: 2 }),
    ]

    const eligible = sortAccountsForPick(
      candidates.filter((account) => isAccountEligibleForPick(account, now)),
    )

    assert.equal(eligible.length, 4)
    assert.equal(eligible[0].id, '2')
    assert.equal(eligible.some((account) => account.id === '3'), false)
  })
})

describe('account availability scheduling', () => {
  const now = new Date('2026-07-04T12:00:00Z')

  it('returns now for an active account under the daily cap', () => {
    const account = makeAccount({ id: 'a', label: 'A', airbnbEmail: 'a@test.com' })
    assert.equal(accountNextAvailableAt(account, now)?.getTime(), now.getTime())
  })

  it('returns cooldownUntil for a cooled-down account', () => {
    const cooldownUntil = new Date('2026-07-04T18:00:00Z')
    const account = makeAccount({
      id: 'c',
      label: 'C',
      airbnbEmail: 'c@test.com',
      status: AccountStatus.COOLDOWN,
      cooldownUntil,
    })
    assert.equal(accountNextAvailableAt(account, now)?.getTime(), cooldownUntil.getTime())
  })

  it('returns next Colombia midnight when at the daily cap', () => {
    const account = makeAccount({
      id: 'cap',
      label: 'Cap',
      airbnbEmail: 'cap@test.com',
      messagesSentToday: getDailyMessageCap(),
    })
    const at = accountNextAvailableAt(account, now)
    // 2026-07-04 12:00Z → próxima medianoche Colombia = 2026-07-05 05:00Z
    assert.equal(at?.toISOString(), '2026-07-05T05:00:00.000Z')
  })

  it('returns null for blocked accounts (never auto-available)', () => {
    const account = makeAccount({
      id: 'b',
      label: 'B',
      airbnbEmail: 'b@test.com',
      status: AccountStatus.BLOCKED,
    })
    assert.equal(accountNextAvailableAt(account, now), null)
  })

  it('computes next Colombia midnight in UTC (offset -5, no DST)', () => {
    assert.equal(
      nextColombiaMidnightUtc(new Date('2026-07-04T12:00:00Z')).toISOString(),
      '2026-07-05T05:00:00.000Z',
    )
    // 03:00Z del día 5 sigue siendo día 4 en Colombia (22:00) → medianoche = 5 a las 05:00Z
    assert.equal(
      nextColombiaMidnightUtc(new Date('2026-07-05T03:00:00Z')).toISOString(),
      '2026-07-05T05:00:00.000Z',
    )
  })
})
