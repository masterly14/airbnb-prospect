import { NextResponse } from "next/server"
import { Prisma } from "@repo/db"
import { isDashboardAuthorized, unauthorizedResponse } from "@/lib/auth/api-auth"
import { createAccount, listAccounts } from "@/lib/accounts/prisma-repository"
import { isProspectAccountMarket } from "@/lib/accounts/markets"
import type { CreateAccountInput } from "@/lib/accounts/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  if (!isDashboardAuthorized(request)) return unauthorizedResponse()

  const accounts = await listAccounts()
  return NextResponse.json({ accounts })
}

export async function POST(request: Request) {
  if (!isDashboardAuthorized(request)) return unauthorizedResponse()

  let body: CreateAccountInput
  try {
    body = (await request.json()) as CreateAccountInput
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  if (!body.label?.trim() || !body.airbnbEmail?.trim()) {
    return NextResponse.json({ error: "label and airbnbEmail are required" }, { status: 400 })
  }

  if (!body.market || !isProspectAccountMarket(body.market)) {
    return NextResponse.json(
      { error: "market is required and must be Bogotá or Medellín" },
      { status: 400 },
    )
  }

  if (body.proxyHost && !body.proxyPort) {
    return NextResponse.json({ error: "proxyPort is required when proxyHost is set" }, { status: 400 })
  }

  if (
    body.proxyPort !== undefined &&
    (!Number.isInteger(body.proxyPort) || body.proxyPort < 1 || body.proxyPort > 65535)
  ) {
    return NextResponse.json({ error: "proxyPort must be an integer between 1 and 65535" }, { status: 400 })
  }

  try {
    const account = await createAccount(body)
    return NextResponse.json({ account }, { status: 201 })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        { error: "An account with this Airbnb email already exists" },
        { status: 409 },
      )
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}
