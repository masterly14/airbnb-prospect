type ConversationLogEvent =
  | 'conversation.turn.start'
  | 'conversation.turn.skip'
  | 'conversation.triage'
  | 'conversation.close_lost'
  | 'conversation.human_takeover'
  | 'conversation.kill_switch'
  | 'conversation.negotiator'
  | 'conversation.policy'
  | 'conversation.send.success'
  | 'conversation.send.failed'
  | 'conversation.turn.complete'
  | 'conversation.error'

export function conversationLog(
  event: ConversationLogEvent,
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
