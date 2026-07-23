import { toComposioUserId } from "./account-user-id"
import { getComposio, getGmailAuthConfigId } from "./client"

export type GmailConnectLinkResult = {
  composioUserId: string
  redirectUrl: string
  connectionRequestId: string
}

export type GmailConnectionResult = {
  composioUserId: string
  composioConnectionId: string
}

export async function createGmailConnectLink(options: {
  accountId: string
  callbackUrl: string
}): Promise<GmailConnectLinkResult> {
  const composio = getComposio()
  const composioUserId = toComposioUserId(options.accountId)
  const authConfigId = getGmailAuthConfigId()

  // Reconectar Gmail deja conexiones previas en Composio; sin allowMultiple
  // el SDK lanza ComposioMultipleConnectedAccountsError.
  const connectionRequest = await composio.connectedAccounts.link(composioUserId, authConfigId, {
    callbackUrl: options.callbackUrl,
    allowMultiple: true,
  })

  if (!connectionRequest.redirectUrl) {
    throw new Error("Composio did not return an OAuth redirect URL")
  }

  return {
    composioUserId,
    redirectUrl: connectionRequest.redirectUrl,
    connectionRequestId: connectionRequest.id,
  }
}

export async function finalizeGmailConnection(options: {
  accountId: string
  connectionRequestId?: string
}): Promise<GmailConnectionResult> {
  const composio = getComposio()
  const composioUserId = toComposioUserId(options.accountId)

  if (options.connectionRequestId) {
    try {
      const connected = await composio.connectedAccounts.get(options.connectionRequestId)
      if (connected.status === "ACTIVE") {
        return { composioUserId, composioConnectionId: connected.id }
      }

      if (connected.status === "INITIATED" || connected.status === "INITIALIZING") {
        const waited = await composio.connectedAccounts.waitForConnection(
          options.connectionRequestId,
          60_000,
        )
        return { composioUserId, composioConnectionId: waited.id }
      }
    } catch {
      // Fall through to list-based resolution
    }
  }

  const list = await composio.connectedAccounts.list({
    userIds: [composioUserId],
    toolkitSlugs: ["gmail"],
    statuses: ["ACTIVE"],
    orderBy: "updated_at",
    limit: 1,
  })

  const connected = list.items[0]
  if (!connected) {
    throw new Error(
      "No active Gmail connection found. Complete OAuth in Composio and try again.",
    )
  }

  return { composioUserId, composioConnectionId: connected.id }
}
