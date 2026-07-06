import { OPERATIONS } from "@/lib/operations/constants"

export const DEFAULT_MVP_ACCOUNT_ID = "69b667ad-a532-444e-a084-44ac7943daa8"

export function getMvpAccountId(): string | null {
  const explicit = process.env.MVP_ACCOUNT_ID?.trim()
  if (explicit) return explicit

  if (process.env.MVP_SINGLE_ACCOUNT === "true") {
    return DEFAULT_MVP_ACCOUNT_ID
  }

  return null
}

export function isMvpSingleAccountMode(): boolean {
  return getMvpAccountId() !== null
}

export function getProspectAccountTarget(): number {
  return isMvpSingleAccountMode() ? 1 : OPERATIONS.PROSPECT_ACCOUNTS
}
