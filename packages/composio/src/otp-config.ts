import type { ComposioConfig, ComposioOtpAccount } from "./types"
import { toComposioUserId } from "./account-user-id"
import { getComposioApiKey } from "./client"

const DEFAULT_GMAIL_TOOLKIT_VERSION = "20260506_01"

export function getGmailToolkitVersion(): string {
  return (
    process.env.COMPOSIO_GMAIL_TOOLKIT_VERSION ??
    process.env.COMPOSIO_TOOLKIT_VERSION_GMAIL ??
    DEFAULT_GMAIL_TOOLKIT_VERSION
  )
}

export function buildOtpConfigFromAccount(
  account: ComposioOtpAccount & { id?: string },
): ComposioConfig {
  const apiKey = getComposioApiKey()

  const userId =
    (account.id ? toComposioUserId(account.id) : "") ||
    account.composioUserId?.trim() ||
    process.env.COMPOSIO_USER_ID?.trim() ||
    ""

  const connectionId =
    account.composioConnectionId?.trim() || process.env.COMPOSIO_CONNECTION_ID?.trim() || ""

  if (!userId) {
    throw new Error(
      "No Composio userId for account. Connect Gmail from /settings/accounts or set COMPOSIO_USER_ID (deprecated).",
    )
  }

  return {
    apiKey,
    userId,
    connectionId,
    gmailToolkitVersion: getGmailToolkitVersion(),
    timeoutMs: Number(process.env.COMPOSIO_2FA_TIMEOUT_MS ?? 90_000),
    pollMs: Number(process.env.COMPOSIO_2FA_POLL_MS ?? 5_000),
  }
}
