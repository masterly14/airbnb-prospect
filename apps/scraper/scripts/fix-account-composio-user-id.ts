import dotenv from 'dotenv'
import path from 'path'
import { toComposioUserId } from '@repo/composio'
import { db } from '@repo/db'

dotenv.config({ path: path.resolve(__dirname, '../../../.env') })

async function main() {
  const accountId = process.argv[2]?.trim()
  if (!accountId) {
    console.error('Usage: tsx scripts/fix-account-composio-user-id.ts <accountId> [--clear-connection]')
    process.exit(1)
  }

  const clearConnection = process.argv.includes('--clear-connection')
  const account = await db.prospectAccount.findUnique({ where: { id: accountId } })
  if (!account) {
    console.error(`Account not found: ${accountId}`)
    process.exit(1)
  }

  const expectedUserId = toComposioUserId(accountId)
  const updated = await db.prospectAccount.update({
    where: { id: accountId },
    data: {
      composioUserId: expectedUserId,
      ...(clearConnection
        ? {
            composioConnectionId: null,
            composioConnectedAt: null,
          }
        : {}),
    },
  })

  console.log(
    JSON.stringify(
      {
        action: 'fixed_composio_user_id',
        accountId: updated.id,
        label: updated.label,
        airbnbEmail: updated.airbnbEmail,
        previousComposioUserId: account.composioUserId,
        composioUserId: updated.composioUserId,
        composioConnectionId: updated.composioConnectionId,
        clearedConnection: clearConnection,
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error('fix-account-composio-user-id failed:', error)
  process.exit(1)
})
