import type { AccountStatus, BlockType } from "@repo/db/client"
import type { ProspectAccountMarket } from "./markets"

export type ProspectAccountSummary = {
  id: string
  label: string
  airbnbEmail: string
  market: ProspectAccountMarket | null
  composioUserId: string | null
  composioConnectionId: string | null
  composioConnectedAt: Date | null
  proxyHost: string | null
  proxyPort: number | null
  proxyUser: string | null
  sessionPath: string | null
  messagesSentToday: number
  waveMessagesSent: number
  status: AccountStatus
  rateLimitedAt: Date | null
  cooldownUntil: Date | null
  lastWaveStartedAt: Date | null
  createdAt: Date
  updatedAt: Date
  recentBlocks: AccountBlockSummary[]
}

export type AccountBlockSummary = {
  id: string
  type: BlockType
  message: string
  occurredAt: Date
}

export type CreateAccountInput = {
  label: string
  airbnbEmail: string
  market: ProspectAccountMarket
  password?: string
  proxyHost?: string
  proxyPort?: number
  proxyUser?: string
  proxyPass?: string
  sessionPath?: string
}

export type UpdateAccountInput = {
  label?: string
  status?: AccountStatus
  market?: ProspectAccountMarket | null
  proxyHost?: string | null
  proxyPort?: number | null
  proxyUser?: string | null
  proxyPass?: string
  sessionPath?: string | null
}
