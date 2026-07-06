import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db = globalForPrisma.prisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db
}

export {
  AccountStatus,
  BlockType,
  ContactSource,
  LeadStatus,
  MessageDirection,
  IcpSkipReason,
  Prisma,
  PrismaClient,
  type Lead,
  type Message,
  type ProspectAccount,
  type AccountBlockEvent,
  type CalBooking,
  type DailyOutboundStats,
  type SystemState,
  type HostContact,
  type LeadIdentityAlias,
} from '@prisma/client'
