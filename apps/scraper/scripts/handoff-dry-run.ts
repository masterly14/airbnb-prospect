import dotenv from 'dotenv'
import path from 'path'
import { db } from '@repo/db'
import { buildHandoffEmail, loadHandoffContext } from '../src/notifications/handoff-email'
import { notifyHandoffEmail } from '../src/notifications/notify'

dotenv.config({ path: path.resolve(__dirname, '../../../.env') })

function parseLeadIdArg(): string | null {
  const idx = process.argv.indexOf('--lead-id')
  if (idx === -1) return null
  return process.argv[idx + 1]?.trim() || null
}

function shouldSend(): boolean {
  return process.argv.includes('--send')
}

async function main() {
  const leadId = parseLeadIdArg()
  if (!leadId) {
    throw new Error('Usage: npm run handoff:dry-run -- --lead-id <uuid> [--send]')
  }

  const reasonIdx = process.argv.indexOf('--reason')
  const reason =
    reasonIdx !== -1 && process.argv[reasonIdx + 1]
      ? process.argv[reasonIdx + 1]
      : 'Prueba manual de handoff'

  const context = await loadHandoffContext(leadId, reason)
  if (!context) {
    throw new Error(`Lead not found: ${leadId}`)
  }

  const email = buildHandoffEmail(context)

  console.log('--- Handoff email preview ---')
  console.log(`To: ${process.env.HANDOFF_EMAIL ?? 'svaron066@gmail.com'}`)
  console.log(`Subject: ${email.subject}`)
  console.log('')
  console.log(email.text)
  console.log('--- End preview ---')

  if (shouldSend()) {
    await notifyHandoffEmail(leadId, reason)
    console.log('Email enviado vía Resend (si RESEND_API_KEY y RESEND_FROM están configurados).')
  } else {
    console.log('Modo dry-run. Añade --send para enviar el email real.')
  }

  await db.$disconnect()
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
