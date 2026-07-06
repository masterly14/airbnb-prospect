import type { AccountStatus } from "@repo/db/client"
import type { CreateAccountInput, ProspectAccountSummary, UpdateAccountInput } from "./types"
import {
  assertDashboardResponse,
  getDashboardAuthHeaders,
} from "@/lib/auth/dashboard-client"

type RawAccount = Omit<
  ProspectAccountSummary,
  | "rateLimitedAt"
  | "cooldownUntil"
  | "lastWaveStartedAt"
  | "createdAt"
  | "updatedAt"
  | "composioConnectedAt"
  | "recentBlocks"
> & {
  rateLimitedAt: string | null
  cooldownUntil: string | null
  lastWaveStartedAt: string | null
  composioConnectedAt: string | null
  createdAt: string
  updatedAt: string
  recentBlocks: Array<{
    id: string
    type: string
    message: string
    occurredAt: string
  }>
}

function authHeaders(): HeadersInit {
  return getDashboardAuthHeaders()
}

function parseAccount(raw: RawAccount): ProspectAccountSummary {
  return {
    ...raw,
    status: raw.status as AccountStatus,
    rateLimitedAt: raw.rateLimitedAt ? new Date(raw.rateLimitedAt) : null,
    cooldownUntil: raw.cooldownUntil ? new Date(raw.cooldownUntil) : null,
    lastWaveStartedAt: raw.lastWaveStartedAt ? new Date(raw.lastWaveStartedAt) : null,
    composioConnectedAt: raw.composioConnectedAt ? new Date(raw.composioConnectedAt) : null,
    createdAt: new Date(raw.createdAt),
    updatedAt: new Date(raw.updatedAt),
    recentBlocks: raw.recentBlocks.map((block) => ({
      ...block,
      occurredAt: new Date(block.occurredAt),
    })) as ProspectAccountSummary["recentBlocks"],
  }
}

export async function fetchAccounts(): Promise<ProspectAccountSummary[]> {
  const response = await fetch("/api/accounts", { headers: authHeaders() })
  assertDashboardResponse(response, "/api/accounts")
  const data = (await response.json()) as { accounts: RawAccount[] }
  return data.accounts.map(parseAccount)
}

export async function createAccountRequest(input: CreateAccountInput): Promise<ProspectAccountSummary> {
  const response = await fetch("/api/accounts", {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? "Failed to create account")
  }
  const data = (await response.json()) as { account: RawAccount }
  return parseAccount(data.account)
}

export async function updateAccountRequest(
  id: string,
  input: UpdateAccountInput,
): Promise<ProspectAccountSummary> {
  const response = await fetch(`/api/accounts/${id}`, {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? "Failed to update account")
  }
  const data = (await response.json()) as { account: RawAccount }
  return parseAccount(data.account)
}

export async function connectComposio(accountId: string): Promise<void> {
  const response = await fetch(`/api/accounts/${accountId}/composio/connect`, {
    method: "POST",
    headers: authHeaders(),
  })

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? "Failed to start Gmail connection")
  }

  const data = (await response.json()) as { redirectUrl: string }
  window.location.href = data.redirectUrl
}
