import { Lead, LeadDetail, LeadFilters, LeadStatus, Message, MessageDirection, CreateManualLeadInput, LeadLookupMatch } from "./types"
import { MOCK_LEADS, MOCK_MESSAGES } from "./mock-data"
import type { LeadMetrics, LeadRepository } from "./repository-interface"
import { ApiLeadRepository } from "./api-repository"

class MockLeadRepository implements LeadRepository {
  private leads: Lead[] = [...MOCK_LEADS]
  private messages: Message[] = [...MOCK_MESSAGES]

  async listLeads(filters?: LeadFilters): Promise<Lead[]> {
    // Simular delay de red
    await new Promise(resolve => setTimeout(resolve, 300))

    return this.leads.filter(lead => {
      if (filters?.q) {
        const q = filters.q.toLowerCase()
        if (!lead.name.toLowerCase().includes(q) && !lead.primaryListingName?.toLowerCase().includes(q)) {
          return false
        }
      }
      if (filters?.status && filters.status.length > 0) {
        if (!filters.status.includes(lead.status as LeadStatus)) return false
      }
      if (filters?.minProperties && lead.totalProperties < filters.minProperties) {
        return false
      }
      if (filters?.alertsOnly) {
        const isTakeover = lead.status === LeadStatus.HUMAN_TAKEOVER
        const isOverdue = lead.nextFollowUpAt && lead.nextFollowUpAt < new Date()
        if (!isTakeover && !isOverdue) return false
      }
      return true
    })
  }

  async getLead(id: string): Promise<LeadDetail | null> {
    await new Promise(resolve => setTimeout(resolve, 300))
    const lead = this.leads.find(l => l.id === id)
    if (!lead) return null

    const leadMessages = this.messages
      .filter(m => m.leadId === id)
      .sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime())

    return { ...lead, messages: leadMessages }
  }

  async lookupLeads(query: string): Promise<LeadLookupMatch[]> {
    await new Promise(resolve => setTimeout(resolve, 200))
    const q = query.toLowerCase()
    return this.leads
      .filter((lead) => {
        return (
          lead.name.toLowerCase().includes(q) ||
          lead.companyName?.toLowerCase().includes(q) ||
          lead.hostProfileUrl.toLowerCase().includes(q) ||
          lead.primaryListingUrl.toLowerCase().includes(q) ||
          lead.threadId?.toLowerCase().includes(q)
        )
      })
      .slice(0, 8)
      .map((lead) => ({
        id: lead.id,
        name: lead.name,
        companyName: lead.companyName,
        status: lead.status as LeadStatus,
        hostAirbnbId: lead.hostAirbnbId,
        hostProfileUrl: lead.hostProfileUrl,
        primaryListingUrl: lead.primaryListingUrl,
        threadId: lead.threadId,
        market: lead.market,
        lastContactedAt: lead.lastContactedAt,
        contacted: lead.status !== LeadStatus.LEAD_DISCOVERED,
        matchReasons: ["Coincidencia en mock"],
      }))
  }

  async createManualLead(input: CreateManualLeadInput): Promise<{ lead: Lead; created: boolean }> {
    await new Promise(resolve => setTimeout(resolve, 300))
    const duplicate = this.leads.find(
      (lead) => lead.name.toLowerCase() === input.name.trim().toLowerCase(),
    )
    if (duplicate) return { lead: duplicate, created: false }

    const lead: Lead = {
      id: Math.random().toString(36).slice(2),
      hostAirbnbId: `manual:mock-${Date.now()}`,
      threadId: input.threadUrl ?? null,
      name: input.name.trim(),
      hostProfileUrl: input.hostProfileUrl ?? input.primaryListingUrl ?? "",
      primaryListingUrl: input.primaryListingUrl ?? input.hostProfileUrl ?? "",
      primaryListingName: input.companyName ?? null,
      totalProperties: 1,
      companyName: input.companyName ?? null,
      isSuperhost: false,
      market: input.market ?? null,
      icpSkipReason: null,
      status: input.status ?? LeadStatus.INITIAL_MSG_SENT,
      businessScale: null,
      painPoints: null,
      executiveSummary: input.notes ?? null,
      lastContactedAt: new Date(),
      nextFollowUpAt: null,
      botReplyCount: 0,
      calLinkSent: false,
      calBookedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    this.leads.unshift(lead)
    return { lead, created: true }
  }

  async updateLeadStatus(id: string, status: Lead['status']): Promise<Lead | null> {
    await new Promise(resolve => setTimeout(resolve, 300))
    const index = this.leads.findIndex(l => l.id === id)
    if (index === -1) return null

    this.leads[index] = { ...this.leads[index], status, updatedAt: new Date() }
    return this.leads[index]
  }

  async takeover(id: string): Promise<Lead | null> {
    return this.updateLeadStatus(id, LeadStatus.HUMAN_TAKEOVER)
  }

  async sendManualMessage(id: string, content: string): Promise<Message | null> {
    await new Promise(resolve => setTimeout(resolve, 300))
    const lead = this.leads.find(l => l.id === id)
    if (!lead) return null

    const newMessage: Message = {
      id: Math.random().toString(36).substring(7),
      leadId: id,
      prospectAccountId: null,
      direction: MessageDirection.OUTBOUND,
      content,
      aiIntent: null,
      sentAt: new Date(),
    }
    
    this.messages.push(newMessage)
    
    // Si estaba en HUMAN_TAKEOVER y respondimos, podríamos pasarlo a REPLIED_IN_PROGRESS o dejarlo
    // Para simplificar, no cambiamos estado automáticamente aquí a menos que sea requerido
    return newMessage
  }

  async getMetrics(): Promise<LeadMetrics> {
    await new Promise(resolve => setTimeout(resolve, 200))
    const total = this.leads.length
    const contacted = this.leads.filter(l => l.status !== LeadStatus.LEAD_DISCOVERED).length
    const replied = this.leads.filter(l => 
      ([LeadStatus.REPLIED_IN_PROGRESS, LeadStatus.HUMAN_TAKEOVER, LeadStatus.CLOSED_WON] as LeadStatus[]).includes(l.status as LeadStatus)
    ).length
    const calSent = this.leads.filter(l => l.calLinkSent).length
    const won = this.leads.filter(l => l.status === LeadStatus.CLOSED_WON).length

    return {
      total,
      contacted,
      replied,
      calSent,
      won,
    }
  }
}

/**
 * Por defecto el dashboard consume datos reales de Neon vía la API REST.
 * Para desarrollo sin base de datos, define NEXT_PUBLIC_USE_MOCK=true.
 */
const useMock = process.env.NEXT_PUBLIC_USE_MOCK === "true"

export const leadRepository: LeadRepository = useMock
  ? new MockLeadRepository()
  : new ApiLeadRepository()
