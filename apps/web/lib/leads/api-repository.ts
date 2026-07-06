import type { Lead, LeadDetail, LeadFilters, Message, CreateManualLeadInput, LeadLookupMatch } from "./types"
import type { LeadMetrics, LeadRepository } from "./repository-interface"
import {
  assertDashboardResponse,
  getDashboardAuthHeaders,
} from "@/lib/auth/dashboard-client"

type RawLead = Omit<
  Lead,
  "lastContactedAt" | "nextFollowUpAt" | "createdAt" | "updatedAt" | "calBookedAt"
> & {
  lastContactedAt: string | null
  nextFollowUpAt: string | null
  createdAt: string
  updatedAt: string
  calBookedAt: string | null
}

type RawMessage = Omit<Message, "sentAt"> & { sentAt: string }

function parseLead(raw: RawLead): Lead {
  return {
    ...raw,
    lastContactedAt: raw.lastContactedAt ? new Date(raw.lastContactedAt) : null,
    nextFollowUpAt: raw.nextFollowUpAt ? new Date(raw.nextFollowUpAt) : null,
    createdAt: new Date(raw.createdAt),
    updatedAt: new Date(raw.updatedAt),
    calBookedAt: raw.calBookedAt ? new Date(raw.calBookedAt) : null,
  }
}

function parseMessage(raw: RawMessage): Message {
  return { ...raw, sentAt: new Date(raw.sentAt) }
}

function authHeaders(): HeadersInit {
  return getDashboardAuthHeaders()
}

/**
 * Repositorio del lado del cliente: consume las rutas REST y reconstruye los
 * objetos `Date` (la API serializa fechas como ISO strings).
 */
export class ApiLeadRepository implements LeadRepository {
  private async fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(path, {
      ...init,
      headers: { ...authHeaders(), ...(init?.headers ?? {}) },
    })
    if (!response.ok) {
      assertDashboardResponse(response, path)
    }
    return response.json() as Promise<T>
  }

  async listLeads(filters?: LeadFilters): Promise<Lead[]> {
    const params = new URLSearchParams()
    if (filters?.q) params.set("q", filters.q)
    if (filters?.status?.length) params.set("status", filters.status.join(","))
    if (filters?.minProperties) params.set("minProperties", String(filters.minProperties))
    if (filters?.alertsOnly) params.set("alertsOnly", "true")

    const query = params.toString()
    const data = await this.fetchJson<{ leads: RawLead[] }>(
      `/api/leads${query ? `?${query}` : ""}`,
    )
    return data.leads.map(parseLead)
  }

  async getLead(id: string): Promise<LeadDetail | null> {
    try {
      const data = await this.fetchJson<{ lead: RawLead & { messages: RawMessage[] } }>(
        `/api/leads/${id}`,
      )
      return {
        ...parseLead(data.lead),
        messages: data.lead.messages.map(parseMessage),
      }
    } catch {
      return null
    }
  }

  async lookupLeads(query: string): Promise<LeadLookupMatch[]> {
    const params = new URLSearchParams({ q: query })
    const data = await this.fetchJson<{ matches: Array<Omit<LeadLookupMatch, "lastContactedAt"> & { lastContactedAt: string | null }> }>(
      `/api/leads/lookup?${params.toString()}`,
    )
    return data.matches.map((match) => ({
      ...match,
      lastContactedAt: match.lastContactedAt ? new Date(match.lastContactedAt) : null,
    }))
  }

  async createManualLead(
    input: CreateManualLeadInput,
  ): Promise<{ lead: Lead; created: boolean }> {
    const response = await fetch("/api/leads", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(input),
    })

    const payload = (await response.json()) as {
      lead?: RawLead
      created?: boolean
      error?: string
      message?: string
    }

    if (response.status === 409 && payload.lead) {
      return { lead: parseLead(payload.lead), created: false }
    }

    if (!response.ok) {
      assertDashboardResponse(response, "/api/leads")
    }

    return { lead: parseLead(payload.lead!), created: payload.created ?? true }
  }

  async updateLeadStatus(id: string, status: Lead["status"]): Promise<Lead | null> {
    try {
      const data = await this.fetchJson<{ lead: RawLead }>(`/api/leads/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })
      return parseLead(data.lead)
    } catch {
      return null
    }
  }

  async takeover(id: string): Promise<Lead | null> {
    try {
      const data = await this.fetchJson<{ lead: RawLead }>(`/api/leads/${id}/takeover`, {
        method: "POST",
      })
      return parseLead(data.lead)
    } catch {
      return null
    }
  }

  async sendManualMessage(id: string, content: string): Promise<Message | null> {
    try {
      const data = await this.fetchJson<{ message: RawMessage }>(
        `/api/leads/${id}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        },
      )
      return parseMessage(data.message)
    } catch {
      return null
    }
  }

  async getMetrics(): Promise<LeadMetrics> {
    const data = await this.fetchJson<{ metrics: LeadMetrics }>(`/api/metrics`)
    return data.metrics
  }
}
