import { NextResponse } from "next/server"
import { isDashboardAuthorized, unauthorizedResponse } from "@/lib/auth/api-auth"
import { getDashboardStats } from "@/lib/dashboard/stats"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  if (!isDashboardAuthorized(request)) return unauthorizedResponse()

  const stats = await getDashboardStats()
  return NextResponse.json({ stats })
}
