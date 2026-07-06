import { NextResponse } from "next/server"
import { isDashboardAuthorized, unauthorizedResponse } from "@/lib/auth/api-auth"
import { prismaLeadRepository } from "@/lib/leads/prisma-repository"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: Request, context: RouteContext) {
  if (!isDashboardAuthorized(request)) return unauthorizedResponse()

  const { id } = await context.params
  const lead = await prismaLeadRepository.takeover(id)

  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 })
  }

  return NextResponse.json({ lead })
}
