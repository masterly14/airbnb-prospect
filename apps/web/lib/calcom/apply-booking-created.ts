import { db, LeadStatus, MessageDirection } from '@repo/db'
import type { CalComBookingPayload } from './parse-payload'
import { extractLeadIdFromMetadata } from './parse-payload'

export type ApplyBookingCreatedResult =
  | { ok: true; leadId: string; calUid: string; duplicate: boolean }
  | { ok: false; reason: 'missing_lead_id' | 'lead_not_found' }

function primaryAttendee(payload: CalComBookingPayload): { email?: string; name?: string } {
  const attendee = payload.attendees?.[0]
  return {
    email: attendee?.email,
    name: attendee?.name,
  }
}

export async function applyBookingCreated(
  payload: CalComBookingPayload,
  triggerEvent = 'BOOKING_CREATED',
): Promise<ApplyBookingCreatedResult> {
  const leadId = extractLeadIdFromMetadata(payload.metadata)
  if (!leadId) {
    console.warn('[calcom] BOOKING_CREATED without metadata.leadId', { calUid: payload.uid })
    return { ok: false, reason: 'missing_lead_id' }
  }

  const existingBooking = await db.calBooking.findUnique({
    where: { calUid: payload.uid },
  })

  if (existingBooking) {
    return {
      ok: true,
      leadId: existingBooking.leadId,
      calUid: payload.uid,
      duplicate: true,
    }
  }

  const lead = await db.lead.findUnique({ where: { id: leadId } })
  if (!lead) {
    console.warn('[calcom] lead not found for booking', { leadId, calUid: payload.uid })
    return { ok: false, reason: 'lead_not_found' }
  }

  const startTime = new Date(payload.startTime)
  const endTime = payload.endTime ? new Date(payload.endTime) : null
  const attendee = primaryAttendee(payload)
  const systemMessage = `Cal.com: agendado — ${startTime.toISOString()} — uid:${payload.uid}`

  await db.$transaction(async (tx) => {
    await tx.calBooking.create({
      data: {
        calUid: payload.uid,
        calBookingId: payload.bookingId ?? null,
        leadId: lead.id,
        triggerEvent,
        startTime,
        endTime,
        attendeeEmail: attendee.email ?? null,
        attendeeName: attendee.name ?? null,
        eventTypeSlug: payload.type ?? null,
      },
    })

    await tx.lead.update({
      where: { id: lead.id },
      data: {
        status: LeadStatus.CLOSED_WON,
        calBookedAt: startTime,
        nextFollowUpAt: null,
      },
    })

    await tx.message.create({
      data: {
        leadId: lead.id,
        direction: MessageDirection.SYSTEM,
        content: systemMessage,
      },
    })
  })

  return { ok: true, leadId: lead.id, calUid: payload.uid, duplicate: false }
}
