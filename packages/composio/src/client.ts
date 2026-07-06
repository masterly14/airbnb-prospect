import { Composio } from "@composio/core"
import { getGmailToolkitVersion } from "./otp-config"

let cachedClient: Composio | null = null

export function getComposioApiKey(): string {
  const apiKey = process.env.COMPOSIO_API_KEY?.trim()
  if (!apiKey) {
    throw new Error("COMPOSIO_API_KEY is not configured")
  }
  return apiKey
}

export function getGmailAuthConfigId(): string {
  const authConfigId = process.env.COMPOSIO_GMAIL_AUTH_CONFIG_ID?.trim()
  if (!authConfigId) {
    throw new Error("COMPOSIO_GMAIL_AUTH_CONFIG_ID is not configured")
  }
  return authConfigId
}

export function getAppUrl(): string {
  const appUrl = process.env.APP_URL?.trim() ?? "http://localhost:3000"
  return appUrl.replace(/\/$/, "")
}

export function getComposio(): Composio {
  if (cachedClient) return cachedClient

  cachedClient = new Composio({
    apiKey: getComposioApiKey(),
    toolkitVersions: { gmail: getGmailToolkitVersion() },
  })

  return cachedClient
}

export function resetComposioClient(): void {
  cachedClient = null
}
