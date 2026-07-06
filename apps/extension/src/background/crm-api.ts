import { CrmClient, CrmClientError, type CreateManualLeadInput, type LeadLookupMatch } from "@repo/crm-client"
import { getRequiredConfig } from "./settings"

function toErrorResponse(error: unknown): { error: string; status?: number; needsConfig?: boolean } {
  if (error instanceof CrmClientError) {
    return {
      error: error.message,
      status: error.status,
      needsConfig: error.status === 401,
    }
  }
  return {
    error: error instanceof Error ? error.message : String(error),
    needsConfig: error instanceof Error && error.message.includes("Configura"),
  }
}

async function createClient(): Promise<CrmClient> {
  const config = await getRequiredConfig()
  return new CrmClient({
    baseUrl: config.crmBaseUrl,
    dashboardToken: config.dashboardToken,
  })
}

export async function lookupInCrm(queries: string[]) {
  try {
    const client = await createClient()
    let lastQuery: string | null = null
    let allMatches: LeadLookupMatch[] = []

    for (const query of queries.map((q) => q.trim()).filter(Boolean)) {
      lastQuery = query
      const matches = await client.lookupLeads(query)
      allMatches = mergeMatches(allMatches, matches)
      if (matches.length > 0) break
    }

    return {
      ok: true as const,
      query: lastQuery,
      matches: allMatches,
    }
  } catch (error) {
    return {
      ok: false as const,
      ...toErrorResponse(error),
    }
  }
}

export async function createLeadInCrm(input: CreateManualLeadInput) {
  try {
    const client = await createClient()
    const result = await client.createManualLead(input)
    return {
      ok: true as const,
      ...result,
    }
  } catch (error) {
    return {
      ok: false as const,
      ...toErrorResponse(error),
    }
  }
}

function mergeMatches(existing: LeadLookupMatch[], incoming: LeadLookupMatch[]): LeadLookupMatch[] {
  const byId = new Map(existing.map((match) => [match.id, match]))
  for (const match of incoming) {
    byId.set(match.id, match)
  }
  return [...byId.values()]
}
