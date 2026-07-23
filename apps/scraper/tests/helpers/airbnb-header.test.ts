import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

describe('airbnb-header helpers', () => {
  it('uses cypress-headernav-profile instead of nav button.last()', () => {
    const source = readFileSync(path.join(__dirname, 'airbnb-header.ts'), 'utf8')
    assert.match(source, /cypress-headernav-profile/)
    assert.doesNotMatch(source, /getByRole\('button'\)\.last\(\)/)
  })
})
