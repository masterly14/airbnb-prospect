export type ExtensionConfig = {
  crmBaseUrl: string
  dashboardToken: string
}

export const CONFIG_STORAGE_KEY = "airbnb-crm-config"

export function normalizeCrmBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "")
}

export function isValidCrmBaseUrl(value: string): boolean {
  try {
    const url = new URL(normalizeCrmBaseUrl(value))
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

export function isCompleteConfig(config: Partial<ExtensionConfig> | null | undefined): config is ExtensionConfig {
  return Boolean(config?.crmBaseUrl && isValidCrmBaseUrl(config.crmBaseUrl) && config.dashboardToken)
}
