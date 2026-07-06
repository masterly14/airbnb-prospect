import { browser } from "wxt/browser"
import { CONFIG_STORAGE_KEY, type ExtensionConfig, isCompleteConfig, normalizeCrmBaseUrl } from "../config"

export async function getStoredConfig(): Promise<Partial<ExtensionConfig> | null> {
  const values = await browser.storage.local.get(CONFIG_STORAGE_KEY)
  const config = values[CONFIG_STORAGE_KEY] as Partial<ExtensionConfig> | undefined
  if (!config) return null
  return {
    crmBaseUrl: config.crmBaseUrl ? normalizeCrmBaseUrl(config.crmBaseUrl) : "",
    dashboardToken: config.dashboardToken?.trim() ?? "",
  }
}

export async function saveStoredConfig(config: ExtensionConfig): Promise<void> {
  await browser.storage.local.set({
    [CONFIG_STORAGE_KEY]: {
      crmBaseUrl: normalizeCrmBaseUrl(config.crmBaseUrl),
      dashboardToken: config.dashboardToken.trim(),
    },
  })
}

export async function getRequiredConfig(): Promise<ExtensionConfig> {
  const config = await getStoredConfig()
  if (!isCompleteConfig(config)) {
    throw new Error("Configura la URL del CRM y el dashboard token en las opciones de la extensión.")
  }
  return config
}
