import { assertDashboardResponse, getDashboardAuthHeaders } from "@/lib/auth/dashboard-client"
import type { DashboardStats } from "./types"

export async function fetchDashboardStats(): Promise<DashboardStats> {
  const response = await fetch("/api/dashboard/stats", {
    headers: getDashboardAuthHeaders(),
    cache: "no-store",
  })
  assertDashboardResponse(response, "/api/dashboard/stats")
  const data = (await response.json()) as { stats: DashboardStats }
  return data.stats
}
