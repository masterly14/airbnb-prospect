import { NextResponse } from "next/server"
import { isDashboardAuthorized, unauthorizedResponse } from "@/lib/auth/api-auth"
import { prismaLeadRepository } from "@/lib/leads/prisma-repository"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: Request, context: RouteContext) {
  if (!isDashboardAuthorized(request)) return unauthorizedResponse()

  const { id } = await context.params

  let body: { content?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const content = body.content?.trim()
  if (!content) {
    return NextResponse.json({ error: "Missing content" }, { status: 400 })
  }

  const message = await prismaLeadRepository.sendManualMessage(id, content)
  if (!message) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 })
  }

  return NextResponse.json({ message })
}
