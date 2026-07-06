import type { Prisma } from "@repo/db"
import { db, ContactSource, LeadStatus as PrismaLeadStatus, MessageDirection } from "@repo/db"
import {
  findLeadsByListingId,
  isClusterContacted,
  isLeadContacted,
  legacyThreadHostId,
  listingHostId,
  markHostContacted,
  resolveCanonicalHostIds,
  resolveLeadIdentityCluster,
  threadHostId,
} from "@repo/lead-contact"
import { parseListingId } from "@repo/airbnb-parse"
import type { Lead, LeadDetail, LeadFilters, Message, CreateManualLeadInput, LeadLookupMatch } from "./types"
import { LeadStatus } from "./types"
import type { LeadMetrics, LeadRepository } from "./repository-interface"
import { parseLeadLookupQuery, resolveManualLeadRefs } from "./host-id"

async function isLeadOrClusterContacted(lead: Lead): Promise<boolean> {
  if (isLeadContacted({ status: lead.status as LeadStatus, threadId: lead.threadId })) {
    return true
  }
  const cluster = await resolveLeadIdentityCluster(db, lead)
  const clusterStatus = await isClusterContacted(db, cluster)
  return clusterStatus.contacted
}

function toLookupMatch(lead: Lead, matchReasons: string[], contacted = isLeadContacted({ status: lead.status as LeadStatus, threadId: lead.threadId })): LeadLookupMatch {
  return {
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
    contacted,
    matchReasons,
  }
}

/**
 * Repositorio real respaldado por Neon (Prisma). Solo se ejecuta en el
 * servidor (route handlers / Server Components).
 */
export class PrismaLeadRepository implements LeadRepository {
  async listLeads(filters?: LeadFilters): Promise<Lead[]> {
    const where: Prisma.LeadWhereInput = {}

    if (filters?.q) {
      where.OR = [
        { name: { contains: filters.q, mode: "insensitive" } },
        { primaryListingName: { contains: filters.q, mode: "insensitive" } },
        { companyName: { contains: filters.q, mode: "insensitive" } },
        { hostProfileUrl: { contains: filters.q, mode: "insensitive" } },
        { primaryListingUrl: { contains: filters.q, mode: "insensitive" } },
        { threadId: { contains: filters.q, mode: "insensitive" } },
        { hostAirbnbId: { contains: filters.q, mode: "insensitive" } },
      ]
    }

    if (filters?.status && filters.status.length > 0) {
      where.status = { in: filters.status as unknown as PrismaLeadStatus[] }
    }

    if (filters?.minProperties || filters?.maxProperties) {
      where.totalProperties = {}
      if (filters.minProperties) {
        where.totalProperties.gte = filters.minProperties
      }
      if (filters.maxProperties) {
        where.totalProperties.lte = filters.maxProperties
      }
    }

    if (filters?.superhostOnly) {
      where.isSuperhost = true
    }

    if (filters?.alertsOnly) {
      where.AND = [
        {
          OR: [
            { status: PrismaLeadStatus.HUMAN_TAKEOVER },
            { nextFollowUpAt: { lt: new Date() } },
          ],
        },
      ]
    }

    return db.lead.findMany({
      where,
      orderBy: { updatedAt: "desc" },
    })
  }

  async getLead(id: string): Promise<LeadDetail | null> {
    const lead = await db.lead.findUnique({
      where: { id },
      include: { messages: { orderBy: { sentAt: "asc" } } },
    })
    return lead
  }

  async lookupLeads(query: string): Promise<LeadLookupMatch[]> {
    const hints = parseLeadLookupQuery(query)
    if (!hints.textQuery && !hints.hostAirbnbId && !hints.listingId && !hints.threadId) {
      return []
    }

    const or: Prisma.LeadWhereInput[] = []

    if (hints.hostAirbnbId) {
      const hostIds = await resolveCanonicalHostIds(db, hints.hostAirbnbId)
      or.push({ hostAirbnbId: { in: hostIds } })
    }
    if (hints.listingId) {
      or.push(
        { hostAirbnbId: listingHostId(hints.listingId) },
        { primaryListingUrl: { contains: `/rooms/${hints.listingId}`, mode: "insensitive" } },
      )
      const aliasRows = await db.leadIdentityAlias.findMany({
        where: { aliasId: listingHostId(hints.listingId) },
      })
      for (const alias of aliasRows) {
        or.push({ hostAirbnbId: alias.canonicalId })
        if (alias.leadId) {
          or.push({ id: alias.leadId })
        }
      }
    }
    if (hints.threadId) {
      or.push(
        { hostAirbnbId: threadHostId(hints.threadId) },
        { hostAirbnbId: legacyThreadHostId(hints.threadId) },
        { threadId: { contains: hints.threadId, mode: "insensitive" } },
      )
    }
    if (hints.profileUrl) {
      or.push({ hostProfileUrl: { contains: hints.profileUrl, mode: "insensitive" } })
    }
    if (hints.listingUrl) {
      or.push({ primaryListingUrl: { contains: hints.listingUrl, mode: "insensitive" } })
    }
    if (hints.threadUrl) {
      or.push({ threadId: { contains: hints.threadUrl, mode: "insensitive" } })
    }
    if (hints.textQuery) {
      or.push(
        { name: { contains: hints.textQuery, mode: "insensitive" } },
        { companyName: { contains: hints.textQuery, mode: "insensitive" } },
        { primaryListingName: { contains: hints.textQuery, mode: "insensitive" } },
      )
    }

    const leads = await db.lead.findMany({
      where: { OR: or },
      orderBy: { updatedAt: "desc" },
      take: 8,
    })

    const mergedLeads = [...leads]
    for (const clusterLead of hints.listingId
      ? await findLeadsByListingId(db, hints.listingId)
      : []) {
      if (!mergedLeads.some((lead) => lead.id === clusterLead.id)) {
        mergedLeads.push(clusterLead)
      }
    }

    const results: LeadLookupMatch[] = []
    for (const lead of mergedLeads.slice(0, 8)) {
      const reasons: string[] = []
      if (hints.hostAirbnbId && lead.hostAirbnbId === hints.hostAirbnbId) {
        reasons.push("Mismo hostAirbnbId")
      }
      if (hints.threadId && lead.threadId?.includes(hints.threadId)) {
        reasons.push("Mismo hilo de mensajes")
      }
      if (hints.listingId && lead.primaryListingUrl.includes(`/rooms/${hints.listingId}`)) {
        reasons.push("Mismo anuncio")
      }
      if (hints.listingId && lead.hostAirbnbId === listingHostId(hints.listingId)) {
        reasons.push("Alias de anuncio")
      }
      if (
        hints.textQuery &&
        (lead.name.toLowerCase().includes(hints.textQuery.toLowerCase()) ||
          lead.companyName?.toLowerCase().includes(hints.textQuery.toLowerCase()))
      ) {
        reasons.push("Nombre o empresa similar")
      }
      if (reasons.length === 0) reasons.push("Coincidencia por cluster de identidad")
      const contacted = await isLeadOrClusterContacted(lead)
      results.push(toLookupMatch(lead, reasons, contacted))
    }

    return results
  }

  async createManualLead(
    input: CreateManualLeadInput,
  ): Promise<{ lead: Lead; created: boolean }> {
    const name = input.name.trim()
    if (!name) {
      throw new Error("El nombre del anfitrión es obligatorio.")
    }

    const refs = resolveManualLeadRefs({
      name,
      hostProfileUrl: input.hostProfileUrl,
      primaryListingUrl: input.primaryListingUrl,
      threadUrl: input.threadUrl,
    })

    const listingId = input.primaryListingUrl ? parseListingId(input.primaryListingUrl) : null
    if (listingId) {
      const listingMatches = await findLeadsByListingId(db, listingId)
      for (const match of listingMatches) {
        const cluster = await resolveLeadIdentityCluster(db, match)
        const clusterStatus = await isClusterContacted(db, cluster)
        if (clusterStatus.contacted) {
          return { lead: match, created: false }
        }
      }
    }

    const existing = await db.lead.findFirst({
      where: {
        OR: [
          { hostAirbnbId: refs.hostAirbnbId },
          ...(refs.threadId ? [{ threadId: refs.threadId }] : []),
          ...(listingId ? [{ hostAirbnbId: listingHostId(listingId) }] : []),
        ],
      },
    })
    if (existing) {
      return { lead: existing, created: false }
    }

    const status = (input.status ?? LeadStatus.INITIAL_MSG_SENT) as PrismaLeadStatus
    const now = new Date()
    const notes = input.notes?.trim()

    const lead = await db.$transaction(async (tx) => {
      const created = await tx.lead.create({
        data: {
          hostAirbnbId: refs.hostAirbnbId,
          threadId: refs.threadId,
          name,
          companyName: input.companyName?.trim() || null,
          hostProfileUrl: refs.hostProfileUrl,
          primaryListingUrl: refs.primaryListingUrl,
          primaryListingName: input.companyName?.trim() || null,
          market: input.market?.trim() || null,
          status,
          executiveSummary: notes || null,
          lastContactedAt: isLeadContacted({ status: status as LeadStatus, threadId: refs.threadId })
            ? now
            : null,
        },
      })

      if (notes) {
        await tx.message.create({
          data: {
            leadId: created.id,
            direction: MessageDirection.SYSTEM,
            content: `Registro manual: ${notes}`,
            aiIntent: "MANUAL_REGISTER",
          },
        })
      } else {
        await tx.message.create({
          data: {
            leadId: created.id,
            direction: MessageDirection.SYSTEM,
            content: "Registro manual: contacto registrado desde el dashboard.",
            aiIntent: "MANUAL_REGISTER",
          },
        })
      }

      return created
    })

    if (isLeadContacted({ status: status as LeadStatus, threadId: refs.threadId })) {
      await markHostContacted(db, {
        lead,
        source: ContactSource.MANUAL_REGISTER,
      })
    }

    return { lead, created: true }
  }

  async updateLeadStatus(id: string, status: Lead["status"]): Promise<Lead | null> {
    const exists = await db.lead.findUnique({ where: { id }, select: { id: true } })
    if (!exists) return null

    return db.lead.update({
      where: { id },
      data: { status },
    })
  }

  async takeover(id: string): Promise<Lead | null> {
    const exists = await db.lead.findUnique({ where: { id }, select: { id: true } })
    if (!exists) return null

    return db.lead.update({
      where: { id },
      data: { status: PrismaLeadStatus.HUMAN_TAKEOVER, nextFollowUpAt: null },
    })
  }

  async sendManualMessage(id: string, content: string): Promise<Message | null> {
    const lead = await db.lead.findUnique({ where: { id }, select: { id: true } })
    if (!lead) return null

    const [message] = await db.$transaction([
      db.message.create({
        data: {
          leadId: id,
          direction: MessageDirection.OUTBOUND,
          content,
          aiIntent: "MANUAL",
        },
      }),
      db.lead.update({
        where: { id },
        data: { lastContactedAt: new Date() },
      }),
    ])

    return message
  }

  async getMetrics(): Promise<LeadMetrics> {
    const [total, discovered, replied, calSent, won] = await db.$transaction([
      db.lead.count(),
      db.lead.count({ where: { status: PrismaLeadStatus.LEAD_DISCOVERED } }),
      db.lead.count({
        where: {
          status: {
            in: [
              PrismaLeadStatus.REPLIED_IN_PROGRESS,
              PrismaLeadStatus.HUMAN_TAKEOVER,
              PrismaLeadStatus.CLOSED_WON,
            ],
          },
        },
      }),
      db.lead.count({ where: { calLinkSent: true } }),
      db.lead.count({ where: { status: PrismaLeadStatus.CLOSED_WON } }),
    ])

    return {
      total,
      contacted: total - discovered,
      replied,
      calSent,
      won,
    }
  }
}

export const prismaLeadRepository = new PrismaLeadRepository()
