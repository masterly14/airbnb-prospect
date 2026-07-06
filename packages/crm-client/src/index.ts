export enum LeadStatus {
  LEAD_DISCOVERED = "LEAD_DISCOVERED",
  INITIAL_MSG_SENT = "INITIAL_MSG_SENT",
  FOLLOW_UP_1_SENT = "FOLLOW_UP_1_SENT",
  FOLLOW_UP_2_SENT = "FOLLOW_UP_2_SENT",
  FOLLOW_UP_3_SENT = "FOLLOW_UP_3_SENT",
  REPLIED_IN_PROGRESS = "REPLIED_IN_PROGRESS",
  HUMAN_TAKEOVER = "HUMAN_TAKEOVER",
  CLOSED_WON = "CLOSED_WON",
  CLOSED_LOST = "CLOSED_LOST",
}

export type CreateManualLeadInput = {
  name: string
  companyName?: string
  hostProfileUrl?: string
  primaryListingUrl?: string
  threadUrl?: string
  market?: string
  status?: LeadStatus
  notes?: string
}

export type CrmLead = {
  id: string
  hostAirbnbId: string
  threadId: string | null
  name: string
  companyName: string | null
  hostProfileUrl: string
  primaryListingUrl: string
  primaryListingName: string | null
  totalProperties: number
  status: LeadStatus
  market: string | null
  executiveSummary: string | null
  lastContactedAt: string | null
}

export type LeadLookupMatch = {
  id: string
  name: string
  companyName: string | null
  status: LeadStatus
  hostAirbnbId: string
  hostProfileUrl: string
  primaryListingUrl: string
  threadId: string | null
  market: string | null
  lastContactedAt: string | null
  contacted: boolean
  matchReasons: string[]
}

export type CrmClientConfig = {
  baseUrl: string
  dashboardToken?: string
  fetchImpl?: typeof fetch
}

export class CrmClientError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly payload?: unknown,
  ) {
    super(message)
    this.name = "CrmClientError"
  }
}

type RawLeadLookupMatch = Omit<LeadLookupMatch, "lastContactedAt"> & {
  lastContactedAt: string | null
}

type RawCrmLead = Omit<CrmLead, "lastContactedAt"> & {
  lastContactedAt: string | null
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "")
}

function authHeaders(dashboardToken?: string): HeadersInit {
  return dashboardToken
    ? {
        "x-dashboard-token": dashboardToken,
      }
    : {}
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const message =
      typeof payload === "object" && payload && "message" in payload
        ? String(payload.message)
        : typeof payload === "object" && payload && "error" in payload
          ? String(payload.error)
          : `CRM request failed with status ${response.status}`
    throw new CrmClientError(message, response.status, payload)
  }
  return payload as T
}

export class CrmClient {
  private readonly baseUrl: string
  private readonly dashboardToken?: string
  private readonly fetchImpl: typeof fetch

  constructor(config: CrmClientConfig) {
    this.baseUrl = normalizeBaseUrl(config.baseUrl)
    this.dashboardToken = config.dashboardToken
    this.fetchImpl = config.fetchImpl ?? fetch.bind(globalThis)
  }

  async lookupLeads(query: string): Promise<LeadLookupMatch[]> {
    const params = new URLSearchParams({ q: query })
    const response = await this.fetchImpl(`${this.baseUrl}/api/leads/lookup?${params.toString()}`, {
      headers: {
        ...authHeaders(this.dashboardToken),
        Accept: "application/json",
      },
    })
    const payload = await parseJsonResponse<{ matches: RawLeadLookupMatch[] }>(response)
    return payload.matches
  }

  async createManualLead(input: CreateManualLeadInput): Promise<{ lead: CrmLead; created: boolean }> {
    const response = await this.fetchImpl(`${this.baseUrl}/api/leads`, {
      method: "POST",
      headers: {
        ...authHeaders(this.dashboardToken),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(input),
    })

    if (response.status === 409) {
      const payload = await response.json().catch(() => null)
      if (payload && typeof payload === "object" && "lead" in payload) {
        return { lead: (payload as { lead: RawCrmLead }).lead, created: false }
      }
    }

    const payload = await parseJsonResponse<{ lead: RawCrmLead; created: boolean }>(response)
    return { lead: payload.lead, created: payload.created }
  }
}
