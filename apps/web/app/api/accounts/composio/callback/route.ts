import { NextResponse } from "next/server"
import { finalizeGmailConnection, getAppUrl } from "@repo/composio"
import { markComposioConnected } from "@/lib/accounts/prisma-repository"
import { verifyOAuthState } from "@/lib/composio/oauth-state"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function redirectToAccounts(params: Record<string, string>): NextResponse {
  const search = new URLSearchParams(params)
  const appUrl = getAppUrl()
  return NextResponse.redirect(new URL(`/settings/accounts?${search.toString()}`, appUrl))
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const stateParam = url.searchParams.get("state")

  if (!stateParam) {
    return redirectToAccounts({ error: "missing_state" })
  }

  let payload
  try {
    payload = verifyOAuthState(stateParam)
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid_state"
    return redirectToAccounts({ error: message })
  }

  if (!payload) {
    return redirectToAccounts({ error: "invalid_state" })
  }

  try {
    const connection = await finalizeGmailConnection({
      accountId: payload.accountId,
      connectionRequestId: payload.connectionRequestId,
    })

    const updated = await markComposioConnected(payload.accountId, connection)
    if (!updated) {
      return redirectToAccounts({ error: "account_not_found" })
    }

    return redirectToAccounts({ connected: "1" })
  } catch (error) {
    const message = error instanceof Error ? error.message : "connection_failed"
    return redirectToAccounts({ error: message })
  }
}
