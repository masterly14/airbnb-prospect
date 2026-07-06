import { NextResponse } from "next/server"
import { isDashboardAuthorized, unauthorizedResponse } from "@/lib/auth/api-auth"
import { prismaLeadRepository } from "@/lib/leads/prisma-repository"
import type { CreateManualLeadInput, LeadFilters, LeadStatus } from "@/lib/leads/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  if (!isDashboardAuthorized(request)) return unauthorizedResponse()

  const { searchParams } = new URL(request.url)

  const filters: LeadFilters = {}

  const q = searchParams.get("q")
  if (q) filters.q = q

  const status = searchParams.get("status")
  if (status) {
    filters.status = status.split(",").map((s) => s.trim()) as LeadStatus[]
  }

  const minProperties = searchParams.get("minProperties")
  if (minProperties) {
    const parsed = Number.parseInt(minProperties, 10)
    if (Number.isFinite(parsed)) filters.minProperties = parsed
  }

  if (searchParams.get("alertsOnly") === "true") {
    filters.alertsOnly = true
  }

  const leads = await prismaLeadRepository.listLeads(filters)
  return NextResponse.json({ leads })
}

export async function POST(request: Request) {
  if (!isDashboardAuthorized(request)) return unauthorizedResponse()

  let body: CreateManualLeadInput
  try {
    body = (await request.json()) as CreateManualLeadInput
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  if (!body.name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 })
  }

  try {
    const result = await prismaLeadRepository.createManualLead(body)
    if (!result.created) {
      return NextResponse.json(
        {
          error: "duplicate",
          message: "Este prospecto ya existe en el CRM.",
          lead: result.lead,
        },
        { status: 409 },
      )
    }
    return NextResponse.json({ lead: result.lead, created: true }, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}
