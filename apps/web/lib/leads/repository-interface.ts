import type { Lead, LeadDetail, LeadFilters, Message, CreateManualLeadInput, LeadLookupMatch } from "./types"

export type LeadMetrics = {
  total: number
  contacted: number
  replied: number
  calSent: number
  won: number
}

/**
 * Contrato que consume el dashboard. Lo implementan tanto el mock como el
 * repositorio real (Prisma en server, fetch en client).
 */
export interface LeadRepository {
  listLeads(filters?: LeadFilters): Promise<Lead[]>
  getLead(id: string): Promise<LeadDetail | null>
  lookupLeads(query: string): Promise<LeadLookupMatch[]>
  createManualLead(input: CreateManualLeadInput): Promise<{ lead: Lead; created: boolean }>
  updateLeadStatus(id: string, status: Lead["status"]): Promise<Lead | null>
  takeover(id: string): Promise<Lead | null>
  sendManualMessage(id: string, content: string): Promise<Message | null>
  getMetrics(): Promise<LeadMetrics>
}
