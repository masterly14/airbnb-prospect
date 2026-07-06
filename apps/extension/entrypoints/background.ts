import type { ExtensionRequest } from "../src/messages"
import { isCompleteConfig } from "../src/config"
import { createLeadInCrm, lookupInCrm } from "../src/background/crm-api"
import { getStoredConfig } from "../src/background/settings"

export default defineBackground(() => {
  browser.runtime.onMessage.addListener(async (message: ExtensionRequest) => {
    switch (message.type) {
      case "CRM_GET_CONFIG": {
        const config = await getStoredConfig()
        return {
          ok: true,
          configured: isCompleteConfig(config),
          config: config?.crmBaseUrl ? { crmBaseUrl: config.crmBaseUrl } : undefined,
        }
      }
      case "CRM_LOOKUP":
        return lookupInCrm(message.queries)
      case "CRM_CREATE":
        return createLeadInCrm(message.input)
      case "CRM_OPEN_OPTIONS":
        await browser.tabs.create({ url: browser.runtime.getURL("/options.html") })
        return { ok: true }
      default:
        return {
          ok: false,
          error: "Mensaje no soportado.",
        }
    }
  })
})
