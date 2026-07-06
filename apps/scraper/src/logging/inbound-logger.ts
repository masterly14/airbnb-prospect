type InboundLogEvent =
  | 'inbound.start'
  | 'inbound.complete'
  | 'inbound.error'
  | 'inbound.poll.start'
  | 'inbound.message.new'
  | 'inbound.lead.replied'
  | 'inbound.sync.complete'

export function inboundLog(
  event: InboundLogEvent,
  data: Record<string, unknown> = {},
): void {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      event,
      ...data,
    }),
  )
}
