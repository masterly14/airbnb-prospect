import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"
import { extractPageContext } from "./extract-context"

describe("extractPageContext", () => {
  it("extracts message thread context", () => {
    const { document, location } = dom(
      "https://www.airbnb.com.co/guest/messages/2583378434",
      "<main><h1>Rocío</h1></main>",
    )

    const context = extractPageContext(document, location)

    assert.equal(context?.pageType, "messages")
    assert.equal(context?.name, "Rocío")
    assert.equal(context?.threadUrl, "https://www.airbnb.com.co/guest/messages/2583378434")
    assert.deepEqual(context?.lookupQueries, ["https://www.airbnb.com.co/guest/messages/2583378434"])
  })

  it("extracts host name and market from real Airbnb listing sections", () => {
    const { document, location } = dom(
      "https://www.airbnb.com.co/rooms/12345678?adults=1",
      `<main>
        <div data-section-id="OVERVIEW_DEFAULT_V2"><h2>Habitación en Bogotá, Colombia</h2></div>
        <div data-section-id="HOST_OVERVIEW_DEFAULT"><div>Anfitrión: Wilson Javier</div><span>Superanfitrión · 4 años anfitrionando</span></div>
        <div data-section-id="MEET_YOUR_HOST"><h2>Conoce al anfitrión</h2></div>
       </main>`,
    )

    const context = extractPageContext(document, location)

    assert.equal(context?.pageType, "listing")
    assert.equal(context?.name, "Wilson Javier")
    assert.equal(context?.market, "Bogotá")
    assert.equal(context?.primaryListingUrl, "https://www.airbnb.com.co/rooms/12345678")
  })

  it("falls back to host profile link text when no host section exists", () => {
    const { document, location } = dom(
      "https://www.airbnb.com.co/rooms/12345678?adults=1",
      '<main><a href="/users/show/98765">Ana</a></main>',
    )

    const context = extractPageContext(document, location)

    assert.equal(context?.name, "Ana")
    assert.equal(context?.hostProfileUrl, "https://www.airbnb.com.co/users/show/98765")
    assert.deepEqual(context?.lookupQueries, [
      "https://www.airbnb.com.co/rooms/12345678",
      "https://www.airbnb.com.co/users/show/98765",
    ])
  })

  it("ignores generic host section labels on listings", () => {
    const { document, location } = dom(
      "https://www.airbnb.com.co/rooms/12345678",
      '<main><div data-section-id="MEET_YOUR_HOST"><h2>Conoce al anfitrión</h2></div></main>',
    )

    const context = extractPageContext(document, location)

    assert.equal(context?.name, "Anfitrión")
    assert.equal(context?.confidence, "medium")
  })

  it("extracts profile context", () => {
    const { document, location } = dom(
      "https://www.airbnb.com.co/users/show/333",
      "<main><h1>Conoce a Lucame Rentals</h1></main>",
    )

    const context = extractPageContext(document, location)

    assert.equal(context?.pageType, "profile")
    assert.equal(context?.name, "Lucame Rentals")
    assert.equal(context?.hostProfileUrl, "https://www.airbnb.com.co/users/show/333")
  })
})

function dom(url: string, html: string): { document: Document; location: Location } {
  const page = new JSDOM(html, { url })
  return {
    document: page.window.document,
    location: page.window.location,
  }
}
