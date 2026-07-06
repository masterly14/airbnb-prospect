import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { createOAuthState, verifyOAuthState } from "./oauth-state"

describe("oauth-state", () => {
  it("signs and verifies state with HMAC", () => {
    process.env.COMPOSIO_OAUTH_STATE_SECRET = "test-oauth-secret"

    const state = createOAuthState({
      accountId: "acc-123",
      connectionRequestId: "conn-456",
    })

    const payload = verifyOAuthState(state)
    assert.ok(payload)
    assert.equal(payload.accountId, "acc-123")
    assert.equal(payload.connectionRequestId, "conn-456")
  })

  it("rejects tampered state", () => {
    process.env.COMPOSIO_OAUTH_STATE_SECRET = "test-oauth-secret"

    const state = createOAuthState({ accountId: "acc-123" })
    const tampered = `${state}x`

    assert.equal(verifyOAuthState(tampered), null)
  })
})
