import { NextResponse } from 'next/server'
import {
  applyBookingCreated,
  parseCalComWebhookJson,
  verifyCalComSignature,
} from '@/lib/calcom'

export async function POST(request: Request) {
  const rawBody = await request.text()
  const signature = request.headers.get('x-cal-signature-256')

  if (!verifyCalComSignature(rawBody, signature)) {
    return NextResponse.json({ ok: false, error: 'Invalid signature' }, { status: 401 })
  }

  const body = parseCalComWebhookJson(rawBody)
  if (!body) {
    return NextResponse.json({ ok: false, error: 'Invalid payload' }, { status: 400 })
  }

  if (body.triggerEvent !== 'BOOKING_CREATED') {
    return NextResponse.json({ ok: true, ignored: true, triggerEvent: body.triggerEvent })
  }

  try {
    const result = await applyBookingCreated(body.payload, body.triggerEvent)

    if (!result.ok) {
      return NextResponse.json({
        ok: true,
        processed: false,
        reason: result.reason,
      })
    }

    return NextResponse.json({
      ok: true,
      processed: true,
      duplicate: result.duplicate,
      leadId: result.leadId,
      calUid: result.calUid,
    })
  } catch (error) {
    console.error('[calcom] webhook handler failed', error)
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
