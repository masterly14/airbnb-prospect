import { OPERATIONS } from "@/lib/operations/constants"

export const DEFAULT_MVP_ACCOUNT_ID = "69b667ad-a532-444e-a084-44ac7943daa8"

export function isMvpSingleAccountMode(): boolean {
  return process.env.MVP_SINGLE_ACCOUNT === "true"
}

export function getMvpAccountId(): string | null {
  if (!isMvpSingleAccountMode()) return null
  const explicit = process.env.MVP_ACCOUNT_ID?.trim()
  return explicit || DEFAULT_MVP_ACCOUNT_ID
}

export function getProspectAccountTarget(): number {
  return isMvpSingleAccountMode() ? 1 : OPERATIONS.PROSPECT_ACCOUNTS
}
