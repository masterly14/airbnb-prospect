import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { CrmClient, CrmClientError, LeadStatus } from "."

describe("CrmClient", () => {
  it("sends lookup request with dashboard token", async () => {
    const requests: RequestInfo[] = []
    const client = new CrmClient({
      baseUrl: "https://crm.example.com/",
      dashboardToken: "secret",
      fetchImpl: async (input, init) => {
        requests.push(input)
        assert.equal((init?.headers as Record<string, string>)["x-dashboard-token"], "secret")
        return jsonResponse({
          matches: [
            {
              id: "lead-1",
              name: "Ana",
              companyName: null,
              status: LeadStatus.INITIAL_MSG_SENT,
              hostAirbnbId: "123",
              hostProfileUrl: "https://www.airbnb.com.co/users/show/123",
              primaryListingUrl: "https://www.airbnb.com.co/rooms/456",
              threadId: null,
              market: null,
              lastContactedAt: null,
              contacted: true,
              matchReasons: ["Mismo hostAirbnbId"],
            },
          ],
        })
      },
    })

    const matches = await client.lookupLeads("Ana")

    assert.equal(String(requests[0]), "https://crm.example.com/api/leads/lookup?q=Ana")
    assert.equal(matches[0]?.name, "Ana")
  })

  it("returns duplicate lead from 409 create response", async () => {
    const client = new CrmClient({
      baseUrl: "https://crm.example.com",
      fetchImpl: async () =>
        jsonResponse(
          {
            error: "duplicate",
            lead: {
              id: "lead-1",
              hostAirbnbId: "manual:thread-1",
              threadId: "https://www.airbnb.com.co/guest/messages/1",
              name: "Ana",
              companyName: null,
              hostProfileUrl: "https://www.airbnb.com.co/guest/messages/1",
              primaryListingUrl: "https://www.airbnb.com.co/guest/messages/1",
              primaryListingName: null,
              totalProperties: 1,
              status: LeadStatus.INITIAL_MSG_SENT,
              market: null,
              executiveSummary: null,
              lastContactedAt: null,
            },
          },
          409,
        ),
    })

    const result = await client.createManualLead({ name: "Ana" })

    assert.equal(result.created, false)
    assert.equal(result.lead.id, "lead-1")
  })

  it("throws typed errors for failed responses", async () => {
    const client = new CrmClient({
      baseUrl: "https://crm.example.com",
      fetchImpl: async () => jsonResponse({ error: "Unauthorized" }, 401),
    })

    await assert.rejects(() => client.lookupLeads("Ana"), (error) => {
      assert.ok(error instanceof CrmClientError)
      assert.equal(error.status, 401)
      return true
    })
  })
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}
