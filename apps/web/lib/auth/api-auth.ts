import { NextResponse } from "next/server"

/**
 * Auth básica para las rutas de operadores del dashboard.
 *
 * Se valida un token compartido (`DASHBOARD_TOKEN`) enviado por header
 * `x-dashboard-token` o `Authorization: Bearer`. Si la variable no está
 * configurada (entorno local), las rutas quedan abiertas para no bloquear el
 * desarrollo. En producción, configura `DASHBOARD_TOKEN` y, idealmente, pon el
 * dashboard detrás de SSO/Vercel Auth.
 */
export function getDashboardToken(request: Request): string | null {
  const header = request.headers.get("x-dashboard-token")
  if (header) return header.trim()

  const authorization = request.headers.get("authorization")
  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice(7).trim()
  }

  return null
}

export function isDashboardAuthorized(request: Request): boolean {
  const expected = process.env.DASHBOARD_TOKEN
  if (!expected) return true
  return getDashboardToken(request) === expected
}

export function unauthorizedResponse() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
}
