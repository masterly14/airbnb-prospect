/** Constantes ICP alineadas con `apps/scraper/src/discovery/icp.ts`. */
import { LeadStatus } from "@repo/db"

export const ICP = {
  MIN_PROPERTIES: 10,
  MAX_PROPERTIES: 25,
  REQUIRE_SUPERHOST: true,
  MARKETS: ["Bogotá", "Medellín"] as const,
  OPTIONAL_MARKETS: ["Cali", "Bucaramanga"] as const,
} as const

export const ICP_PIPELINE_WEEK_THRESHOLD = 7

export function icpEligibleLeadWhere() {
  return {
    status: LeadStatus.LEAD_DISCOVERED,
    isSuperhost: true,
    icpSkipReason: null,
    totalProperties: { gte: ICP.MIN_PROPERTIES, lte: ICP.MAX_PROPERTIES },
  }
}
