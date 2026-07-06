import { NextResponse } from "next/server"
import { AccountStatus } from "@repo/db"
import { isDashboardAuthorized, unauthorizedResponse } from "@/lib/auth/api-auth"
import { updateAccount } from "@/lib/accounts/prisma-repository"
import { isProspectAccountMarket } from "@/lib/accounts/markets"
import type { UpdateAccountInput } from "@/lib/accounts/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(request: Request, context: RouteContext) {
  if (!isDashboardAuthorized(request)) return unauthorizedResponse()

  const { id } = await context.params

  let body: UpdateAccountInput
  try {
    body = (await request.json()) as UpdateAccountInput
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  if (
    body.status !== undefined &&
    !Object.values(AccountStatus).includes(body.status)
  ) {
    return NextResponse.json(
      { error: `Invalid status. Allowed: ${Object.values(AccountStatus).join(", ")}` },
      { status: 400 },
    )
  }

  if (
    body.market !== undefined &&
    body.market !== null &&
    !isProspectAccountMarket(body.market)
  ) {
    return NextResponse.json(
      { error: "market must be Bogotá or Medellín" },
      { status: 400 },
    )
  }

  try {
    const account = await updateAccount(id, body)
    if (!account) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 })
    }
    return NextResponse.json({ account })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}
