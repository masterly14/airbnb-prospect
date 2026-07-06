export type CalComAttendee = {
  email?: string
  name?: string
}

export type CalComBookingPayload = {
  uid: string
  bookingId?: number
  startTime: string
  endTime?: string
  type?: string
  metadata?: Record<string, unknown>
  attendees?: CalComAttendee[]
}

export type CalComWebhookBody = {
  triggerEvent: string
  createdAt?: string
  payload: CalComBookingPayload
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseAttendee(value: unknown): CalComAttendee | undefined {
  if (!isRecord(value)) return undefined
  return {
    email: typeof value.email === 'string' ? value.email : undefined,
    name: typeof value.name === 'string' ? value.name : undefined,
  }
}

export function parseCalComWebhookBody(raw: unknown): CalComWebhookBody | null {
  if (!isRecord(raw)) return null
  if (typeof raw.triggerEvent !== 'string') return null
  if (!isRecord(raw.payload)) return null

  const payload = raw.payload
  if (typeof payload.uid !== 'string' || typeof payload.startTime !== 'string') {
    return null
  }

  const metadata = isRecord(payload.metadata) ? payload.metadata : undefined
  const attendees = Array.isArray(payload.attendees)
    ? payload.attendees.map(parseAttendee).filter((item): item is CalComAttendee => Boolean(item))
    : undefined

  return {
    triggerEvent: raw.triggerEvent,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : undefined,
    payload: {
      uid: payload.uid,
      bookingId: typeof payload.bookingId === 'number' ? payload.bookingId : undefined,
      startTime: payload.startTime,
      endTime: typeof payload.endTime === 'string' ? payload.endTime : undefined,
      type: typeof payload.type === 'string' ? payload.type : undefined,
      metadata,
      attendees,
    },
  }
}

export function extractLeadIdFromMetadata(
  metadata: Record<string, unknown> | undefined,
): string | null {
  if (!metadata) return null
  const leadId = metadata.leadId
  return typeof leadId === 'string' && leadId.trim().length > 0 ? leadId.trim() : null
}

export function parseCalComWebhookJson(rawBody: string): CalComWebhookBody | null {
  try {
    const parsed: unknown = JSON.parse(rawBody)
    return parseCalComWebhookBody(parsed)
  } catch {
    return null
  }
}
