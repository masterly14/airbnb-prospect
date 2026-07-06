import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_MVP_ACCOUNT_ID,
  getMvpAccountId,
  getProspectAccountTarget,
  isMvpSingleAccountMode,
} from './mvp-mode'
import { OPERATIONS } from '../discovery/icp'

describe('mvp-mode', () => {
  const envBackup = { ...process.env }

  beforeEach(() => {
    delete process.env.MVP_ACCOUNT_ID
    delete process.env.MVP_SINGLE_ACCOUNT
  })

  afterEach(() => {
    process.env = { ...envBackup }
  })

  it('is disabled without env vars', () => {
    assert.equal(isMvpSingleAccountMode(), false)
    assert.equal(getMvpAccountId(), null)
    assert.equal(getProspectAccountTarget(), OPERATIONS.PROSPECT_ACCOUNTS)
  })

  it('ignores MVP_ACCOUNT_ID when MVP_SINGLE_ACCOUNT is not true', () => {
    process.env.MVP_ACCOUNT_ID = 'custom-id'
    assert.equal(isMvpSingleAccountMode(), false)
    assert.equal(getMvpAccountId(), null)
    assert.equal(getProspectAccountTarget(), OPERATIONS.PROSPECT_ACCOUNTS)
  })

  it('disables MVP mode when MVP_SINGLE_ACCOUNT=false even with MVP_ACCOUNT_ID set', () => {
    process.env.MVP_SINGLE_ACCOUNT = 'false'
    process.env.MVP_ACCOUNT_ID = 'custom-id'
    assert.equal(isMvpSingleAccountMode(), false)
    assert.equal(getMvpAccountId(), null)
  })

  it('pins account when MVP_SINGLE_ACCOUNT=true and MVP_ACCOUNT_ID is set', () => {
    process.env.MVP_SINGLE_ACCOUNT = 'true'
    process.env.MVP_ACCOUNT_ID = 'custom-id'
    assert.equal(isMvpSingleAccountMode(), true)
    assert.equal(getMvpAccountId(), 'custom-id')
    assert.equal(getProspectAccountTarget(), 1)
  })

  it('uses default Michell account when MVP_SINGLE_ACCOUNT=true', () => {
    process.env.MVP_SINGLE_ACCOUNT = 'true'
    assert.equal(getMvpAccountId(), DEFAULT_MVP_ACCOUNT_ID)
    assert.equal(getProspectAccountTarget(), 1)
  })
})
