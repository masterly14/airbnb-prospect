/**
 * Verifica rutas de bloqueo: status, thread, HostContact, outbound, cluster.
 */
import dotenv from 'dotenv'
import path from 'path'
import crypto from 'crypto'
import { ContactSource, LeadStatus, MessageDirection } from '@repo/db'
import { db } from '@repo/db'
import {
  assertColdOutboundAllowed,
  markHostContacted,
} from '@repo/lead-contact'

dotenv.config({ path: path.resolve(__dirname, '../../../.env'), override: false })

type BlockCase = {
  name: string
  setup: (id: string) => Promise<void>
  expectedReason: string
}

async function main() {
  const suffix = crypto.randomBytes(4).toString('hex')
  const failures: string[] = []

  const cases: BlockCase[] = [
    {
      name: 'status_not_discovered',
      setup: async (id) => {
        await db.lead.create({
          data: {
            id,
            hostAirbnbId: `manual:status-${suffix}`,
            name: 'Status Block Test',
            hostProfileUrl: 'https://example.com',
            primaryListingUrl: 'https://example.com',
            totalProperties: 15,
            isSuperhost: true,
            status: LeadStatus.INITIAL_MSG_SENT,
          },
        })
      },
      expectedReason: 'status_not_discovered',
    },
    {
      name: 'thread_exists',
      setup: async (id) => {
        await db.lead.create({
          data: {
            id,
            hostAirbnbId: `manual:thread-${suffix}`,
            threadId: `https://www.airbnb.com.co/guest/messages/${suffix}`,
            name: 'Thread Block Test',
            hostProfileUrl: 'https://example.com',
            primaryListingUrl: 'https://example.com',
            totalProperties: 15,
            isSuperhost: true,
            status: LeadStatus.LEAD_DISCOVERED,
          },
        })
      },
      expectedReason: 'thread_exists',
    },
    {
      name: 'host_contact_ledger',
      setup: async (id) => {
        const lead = await db.lead.create({
          data: {
            id,
            hostAirbnbId: `manual:ledger-${suffix}`,
            name: 'Ledger Block Test',
            hostProfileUrl: 'https://example.com',
            primaryListingUrl: 'https://example.com',
            totalProperties: 15,
            isSuperhost: true,
            status: LeadStatus.LEAD_DISCOVERED,
          },
        })
        await markHostContacted(db, {
          lead,
          source: ContactSource.BACKFILL,
        })
      },
      expectedReason: 'host_contact_ledger',
    },
    {
      name: 'outbound_message_exists',
      setup: async (id) => {
        await db.lead.create({
          data: {
            id,
            hostAirbnbId: `manual:outbound-${suffix}`,
            name: 'Outbound Block Test',
            hostProfileUrl: 'https://example.com',
            primaryListingUrl: 'https://example.com',
            totalProperties: 15,
            isSuperhost: true,
            status: LeadStatus.LEAD_DISCOVERED,
            messages: {
              create: {
                direction: MessageDirection.OUTBOUND,
                content: 'Hola, mensaje previo',
              },
            },
          },
        })
      },
      expectedReason: 'outbound_message_exists',
    },
  ]

  for (const testCase of cases) {
    const id = `dedup-block-${testCase.name}-${suffix}`
    await db.lead.deleteMany({ where: { id } }).catch(() => {})
    await db.hostContact.deleteMany({ where: { leadId: id } }).catch(() => {})

    try {
      await testCase.setup(id)
      const result = await assertColdOutboundAllowed(db, id)
      if (result.allowed) {
        failures.push(`${testCase.name}: expected block, got allowed`)
      } else if (result.reason !== testCase.expectedReason) {
        failures.push(
          `${testCase.name}: expected ${testCase.expectedReason}, got ${result.reason}`,
        )
      }
    } finally {
      await db.hostContact.deleteMany({ where: { leadId: id } }).catch(() => {})
      await db.message.deleteMany({ where: { leadId: id } }).catch(() => {})
      await db.lead.deleteMany({ where: { id } }).catch(() => {})
    }
  }

  const clusterSuffix = crypto.randomBytes(4).toString('hex')
  const canonicalId = `dedup-canonical-${clusterSuffix}`
  const duplicateId = `dedup-duplicate-${clusterSuffix}`
  const listingId = `777666${clusterSuffix}`

  try {
    await db.lead.create({
      data: {
        id: canonicalId,
        hostAirbnbId: `manual:legacy-${clusterSuffix}`,
        threadId: `https://www.airbnb.com.co/guest/messages/${clusterSuffix}`,
        name: 'Canonical Contacted',
        hostProfileUrl: 'https://example.com',
        primaryListingUrl: 'https://example.com',
        totalProperties: 1,
        isSuperhost: false,
        status: LeadStatus.HUMAN_TAKEOVER,
      },
    })
    await markHostContacted(db, {
      lead: { id: canonicalId, hostAirbnbId: `manual:legacy-${clusterSuffix}` },
      source: ContactSource.MANUAL_SYNC,
    })
    await db.leadIdentityAlias.create({
      data: {
        aliasId: `manual:listing-${listingId}`,
        canonicalId: `manual:legacy-${clusterSuffix}`,
        leadId: canonicalId,
      },
    })
    await db.lead.create({
      data: {
        id: duplicateId,
        hostAirbnbId: `manual:listing-${listingId}`,
        name: 'Duplicate Harvest',
        hostProfileUrl: `https://www.airbnb.com.co/rooms/${listingId}`,
        primaryListingUrl: `https://www.airbnb.com.co/rooms/${listingId}`,
        totalProperties: 15,
        isSuperhost: true,
        status: LeadStatus.LEAD_DISCOVERED,
      },
    })

    const clusterResult = await assertColdOutboundAllowed(db, duplicateId)
    if (clusterResult.allowed || clusterResult.reason !== 'cluster_already_contacted') {
      failures.push(
        `cluster_already_contacted: expected block, got ${clusterResult.allowed ? 'allowed' : clusterResult.reason}`,
      )
    }
  } finally {
    await db.leadIdentityAlias.deleteMany({
      where: { aliasId: `manual:listing-${listingId}` },
    }).catch(() => {})
    await db.hostContact.deleteMany({ where: { leadId: canonicalId } }).catch(() => {})
    await db.lead.deleteMany({ where: { id: { in: [canonicalId, duplicateId] } } }).catch(() => {})
  }

  const passed = failures.length === 0
  console.log(JSON.stringify({ casesRun: cases.length + 1, failures, passed }, null, 2))

  await db.$disconnect()
  if (!passed) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
