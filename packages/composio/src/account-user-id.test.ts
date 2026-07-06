import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { toComposioUserId } from "./account-user-id"

describe("toComposioUserId", () => {
  it("prefixes account UUID with prospect-", () => {
    const accountId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
    assert.equal(toComposioUserId(accountId), `prospect-${accountId}`)
  })

  it("is stable for the same account id", () => {
    const accountId = "00000000-0000-4000-8000-000000000001"
    assert.equal(toComposioUserId(accountId), toComposioUserId(accountId))
  })
})
