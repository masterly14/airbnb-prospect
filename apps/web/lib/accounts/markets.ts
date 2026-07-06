export const PROSPECT_ACCOUNT_MARKETS = ["Bogotá", "Medellín"] as const

export type ProspectAccountMarket = (typeof PROSPECT_ACCOUNT_MARKETS)[number]

export function isProspectAccountMarket(value: string): value is ProspectAccountMarket {
  return (PROSPECT_ACCOUNT_MARKETS as readonly string[]).includes(value)
}
