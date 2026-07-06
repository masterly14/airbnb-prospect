import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { buildOtpConfigFromAccount } from "@repo/composio"

describe("buildOtpConfigFromAccount", () => {
  it("maps account fields to ComposioConfig", () => {
    process.env.COMPOSIO_API_KEY = "test-api-key"

    const config = buildOtpConfigFromAccount({
      id: "00000000-0000-4000-8000-000000000001",
      composioUserId: "prospect-00000000-0000-4000-8000-000000000001",
      composioConnectionId: "conn-abc",
    })

    assert.equal(config.apiKey, "test-api-key")
    assert.equal(config.userId, "prospect-00000000-0000-4000-8000-000000000001")
    assert.equal(config.connectionId, "conn-abc")
    assert.ok(config.gmailToolkitVersion)
  })

  it("derives userId from account id when composioUserId is missing", () => {
    process.env.COMPOSIO_API_KEY = "test-api-key"

    const config = buildOtpConfigFromAccount({
      id: "00000000-0000-4000-8000-000000000002",
      composioConnectionId: null,
    })

    assert.equal(config.userId, "prospect-00000000-0000-4000-8000-000000000002")
  })

  it("prefers account id over a stale composioUserId in the database", () => {
    process.env.COMPOSIO_API_KEY = "test-api-key"

    const config = buildOtpConfigFromAccount({
      id: "a23d0b7c-3998-406a-a7b5-0445760f6ef3",
      composioUserId: "prospect-2d69b43b-392e-4e5f-b5f2-1b390a0d14af",
      composioConnectionId: "ca_legacy",
    })

    assert.equal(config.userId, "prospect-a23d0b7c-3998-406a-a7b5-0445760f6ef3")
  })
})
