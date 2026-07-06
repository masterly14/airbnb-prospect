import React from "react"
import { createRoot, type Root } from "react-dom/client"
import { browser } from "wxt/browser"
import type { CreateManualLeadInput, CrmLead, LeadLookupMatch } from "@repo/crm-client"
import { CrmAlertBanner, type BannerState } from "../src/content/CrmAlertBanner"
import { extractPageContext, type AirbnbPageContext } from "../src/content/extract-context"
import type { CrmCreateResponse, CrmGetConfigResponse, CrmLookupResponse } from "../src/messages"

const MOUNT_ID = "airbnb-crm-alert-root"

export default defineContentScript({
  matches: ["https://www.airbnb.com.co/*", "https://www.airbnb.com/*"],
  runAt: "document_idle",
  main() {
    let root: Root | null = null
    let host: HTMLDivElement | null = null
    let latestRun = 0
    let dismissedPath: string | null = null

    const render = (state: BannerState, crmBaseUrl?: string) => {
      if (dismissedPath === window.location.pathname) return
      const mount = ensureMount()
      root ??= createRoot(mount)
      root.render(
        <CrmAlertBanner
          state={state}
          crmBaseUrl={crmBaseUrl}
          onSave={async (input) => {
            const response = (await browser.runtime.sendMessage({
              type: "CRM_CREATE",
              input,
            })) as CrmCreateResponse

            if (!response.ok) {
              throw new Error(response.error)
            }

            const match = leadToLookupMatch(response.lead)
            render({ kind: "in_crm", context: stateContext(state, input), matches: [match] }, crmBaseUrl)
          }}
          onRetry={() => void refresh()}
          onOpenOptions={() => void browser.runtime.sendMessage({ type: "CRM_OPEN_OPTIONS" })}
          onDismiss={() => {
            dismissedPath = window.location.pathname
            unmount()
          }}
        />,
      )
    }

    const unmount = () => {
      root?.unmount()
      root = null
      host?.remove()
      host = null
    }

    const ensureMount = (): ShadowRoot => {
      host = document.getElementById(MOUNT_ID) as HTMLDivElement | null
      if (!host) {
        host = document.createElement("div")
        host.id = MOUNT_ID
        host.style.position = "fixed"
        host.style.top = "96px"
        host.style.right = "20px"
        host.style.zIndex = "2147483647"
        document.documentElement.append(host)
      }
      return host.shadowRoot ?? host.attachShadow({ mode: "open" })
    }

    const refresh = async () => {
      const runId = ++latestRun
      const context = extractPageContext(document, window.location)
      if (!context) {
        unmount()
        return
      }

      const config = (await browser.runtime.sendMessage({ type: "CRM_GET_CONFIG" })) as CrmGetConfigResponse
      if (!config.configured) {
        render({ kind: "no_config" })
        return
      }

      render({ kind: "loading", context }, config.config?.crmBaseUrl)
      const lookup = (await browser.runtime.sendMessage({
        type: "CRM_LOOKUP",
        queries: context.lookupQueries,
      })) as CrmLookupResponse
      if (runId !== latestRun) return

      if (!lookup.ok) {
        render({ kind: "error", context, message: lookup.error, needsConfig: lookup.needsConfig }, config.config?.crmBaseUrl)
        return
      }

      if (lookup.matches.length === 0) {
        render({ kind: "free", context }, config.config?.crmBaseUrl)
      } else if (lookup.matches.length === 1) {
        render({ kind: "in_crm", context, matches: lookup.matches }, config.config?.crmBaseUrl)
      } else {
        render({ kind: "ambiguous", context, matches: lookup.matches }, config.config?.crmBaseUrl)
      }
    }

    installSpaNavigationListener(() => {
      dismissedPath = null
      void refreshAfterDomSettles(refresh)
    })
    void refreshAfterDomSettles(refresh)
  },
})

function stateContext(state: BannerState, input: CreateManualLeadInput): AirbnbPageContext {
  if (state.kind !== "no_config" && state.kind !== "error") return state.context
  if (state.kind === "error" && state.context) return state.context
  return {
    pageType: "profile",
    sourceUrl: window.location.href,
    lookupQueries: [window.location.href],
    name: input.name,
    hostProfileUrl: input.hostProfileUrl,
    primaryListingUrl: input.primaryListingUrl,
    threadUrl: input.threadUrl,
    confidence: "low",
  }
}

function leadToLookupMatch(lead: CrmLead): LeadLookupMatch {
  return {
    id: lead.id,
    name: lead.name,
    companyName: lead.companyName,
    status: lead.status,
    hostAirbnbId: lead.hostAirbnbId,
    hostProfileUrl: lead.hostProfileUrl,
    primaryListingUrl: lead.primaryListingUrl,
    threadId: lead.threadId,
    market: lead.market,
    lastContactedAt: lead.lastContactedAt,
    contacted: true,
    matchReasons: ["Registro creado desde la extensión"],
  }
}

function installSpaNavigationListener(onChange: () => void) {
  const originalPushState = history.pushState
  const originalReplaceState = history.replaceState

  history.pushState = function pushState(...args) {
    originalPushState.apply(this, args)
    window.dispatchEvent(new Event("airbnb-crm-location-change"))
  }

  history.replaceState = function replaceState(...args) {
    originalReplaceState.apply(this, args)
    window.dispatchEvent(new Event("airbnb-crm-location-change"))
  }

  window.addEventListener("popstate", onChange)
  window.addEventListener("airbnb-crm-location-change", onChange)
}

async function refreshAfterDomSettles(refresh: () => Promise<void>) {
  await refresh()
  window.setTimeout(() => void refresh(), 900)
}
