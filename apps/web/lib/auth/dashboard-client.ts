/**
 * Token del dashboard en el browser. Debe coincidir con `DASHBOARD_TOKEN` del servidor.
 */
export function getDashboardAuthHeaders(): HeadersInit {
  const token = process.env.NEXT_PUBLIC_DASHBOARD_TOKEN
  return token ? { "x-dashboard-token": token } : {}
}

export function dashboardAuthConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_DASHBOARD_TOKEN?.trim())
}

export function assertDashboardResponse(response: Response, path: string): void {
  if (response.ok) return

  if (response.status === 401) {
    throw new Error(
      dashboardAuthConfigured()
        ? `Request failed (401) for ${path}. Check that NEXT_PUBLIC_DASHBOARD_TOKEN matches DASHBOARD_TOKEN.`
        : `Request failed (401) for ${path}. Set NEXT_PUBLIC_DASHBOARD_TOKEN in .env to the same value as DASHBOARD_TOKEN, then restart dev.`,
    )
  }

  throw new Error(`Request failed (${response.status}) for ${path}`)
}
