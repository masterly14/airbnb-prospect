import { NextResponse } from "next/server"
import { createGmailConnectLink, getAppUrl } from "@repo/composio"
import { isDashboardAuthorized, unauthorizedResponse } from "@/lib/auth/api-auth"
import { getAccountById } from "@/lib/accounts/prisma-repository"
import { createOAuthState } from "@/lib/composio/oauth-state"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: Request, context: RouteContext) {
  if (!isDashboardAuthorized(request)) return unauthorizedResponse()

  const { id } = await context.params
  const account = await getAccountById(id)
  if (!account) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 })
  }

  try {
    const appUrl = getAppUrl()
    const signedState = createOAuthState({ accountId: id })
    const callbackUrl = `${appUrl}/api/accounts/composio/callback?state=${encodeURIComponent(signedState)}`

    const link = await createGmailConnectLink({ accountId: id, callbackUrl })

    return NextResponse.json({
      redirectUrl: link.redirectUrl,
      composioUserId: link.composioUserId,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}
