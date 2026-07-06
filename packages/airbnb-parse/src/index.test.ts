import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { parseLeadLookupQuery, parseThreadId, resolveManualLeadRefs } from "."

describe("resolveManualLeadRefs", () => {
  it("uses profile user id when profile url is provided", () => {
    const refs = resolveManualLeadRefs({
      name: "Ana García",
      hostProfileUrl: "https://www.airbnb.com.co/users/show/12345",
    })
    assert.equal(refs.hostAirbnbId, "12345")
    assert.match(refs.hostProfileUrl, /\/users\/show\/12345$/)
  })

  it("falls back to manual slug from name", () => {
    const refs = resolveManualLeadRefs({ name: "Lucame Rentals" })
    assert.equal(refs.hostAirbnbId, "manual:name-lucame-rentals")
  })
})

describe("parseLeadLookupQuery", () => {
  it("extracts thread id from messages url", () => {
    const hints = parseLeadLookupQuery("https://www.airbnb.com.co/guest/messages/2583378434")
    assert.equal(hints.threadId, "2583378434")
  })

  it("uses text query for plain names", () => {
    const hints = parseLeadLookupQuery("Roció")
    assert.equal(hints.textQuery, "Roció")
  })
})

describe("parseThreadId", () => {
  it("parses numeric thread id", () => {
    assert.equal(parseThreadId("/guest/messages/999"), "999")
  })
})
