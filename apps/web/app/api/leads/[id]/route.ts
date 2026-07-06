import { NextResponse } from "next/server"
import { isDashboardAuthorized, unauthorizedResponse } from "@/lib/auth/api-auth"
import { prismaLeadRepository } from "@/lib/leads/prisma-repository"
import type { Lead } from "@/lib/leads/types"
import { LeadStatus } from "@/lib/leads/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: Request, context: RouteContext) {
  if (!isDashboardAuthorized(request)) return unauthorizedResponse()

  const { id } = await context.params
  const lead = await prismaLeadRepository.getLead(id)

  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 })
  }

  return NextResponse.json({ lead })
}

export async function PATCH(request: Request, context: RouteContext) {
  if (!isDashboardAuthorized(request)) return unauthorizedResponse()

  const { id } = await context.params

  let body: { status?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const status = body.status
  if (!status || !(status in LeadStatus)) {
    return NextResponse.json({ error: "Invalid or missing status" }, { status: 400 })
  }

  const lead = await prismaLeadRepository.updateLeadStatus(id, status as Lead["status"])
  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 })
  }

  return NextResponse.json({ lead })
}
