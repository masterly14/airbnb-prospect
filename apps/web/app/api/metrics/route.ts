import { NextResponse } from "next/server"
import { isDashboardAuthorized, unauthorizedResponse } from "@/lib/auth/api-auth"
import { prismaLeadRepository } from "@/lib/leads/prisma-repository"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  if (!isDashboardAuthorized(request)) return unauthorizedResponse()

  const metrics = await prismaLeadRepository.getMetrics()
  return NextResponse.json({ metrics })
}
