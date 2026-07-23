import type { Page } from 'playwright'
import { lastHostReplyForTurn } from '../messaging/thread-message-filters'
import { conversationLog } from '../logging/conversation-logger'
import { sendThreadOutboundMessage } from '../messaging/airbnb-messaging'
import { buildCuriosityReplyMessage } from '../messaging/outbound-templates'
import { notifyAgentError } from '../notifications/notify'
import {
  applyCloseLost,
  applyHumanTakeover,
  isAiPausedStatus,
  recordBotReply,
  tagLatestInboundIntent,
} from '../persistence/conversation-pipeline'
import { loadLeadConversation } from './lead-agent-context'
import {
  classifyHostReply,
  intentToAiTag,
  isMeetingAffirmative,
} from './reply-intent'

export type ConversationTurnOutcome =
  | 'skipped_paused'
  | 'skipped_no_thread'
  | 'skipped_no_inbound'
  | 'skipped_already_replied'
  | 'skipped_ambiguous'
  | 'closed_lost'
  | 'human_takeover'
  | 'replied'
  | 'error'

export type ConversationTurnResult = {
  leadId: string
  outcome: ConversationTurnOutcome
  intent?: string
  error?: string
}

export type ConversationTurnOptions = {
  /**
   * Respuesta del host recién leída en Airbnb.
   * Tiene prioridad sobre el CRM (evita dry-runs / ruido viejo).
   */
  scrapedHostReply?: string | null
}

function alreadySentCuriosityReply(
  messages: Array<{ direction: string; aiIntent?: string | null }>,
): boolean {
  return messages.some(
    (m) => m.direction === 'OUTBOUND' && m.aiIntent === 'CURIOSITY_REPLY',
  )
}

/**
 * Orquestador del turno conversacional post-respuesta del host.
 *
 * Reglas (sin LLM):
 * 1. Rechazo por regex → CLOSED_LOST, no se responde.
 * 2. Cualquier otra respuesta real del host (incl. seca: "Si", "Hola", "Ok")
 *    → mensaje 2 estático (solo si aún no se envió).
 * 3. Tras mensaje 2, si acepta reunión → HUMAN_TAKEOVER (admin gestiona).
 */
export async function runConversationTurn(
  page: Page,
  leadId: string,
  options: ConversationTurnOptions = {},
): Promise<ConversationTurnResult> {
  conversationLog('conversation.turn.start', { leadId })

  try {
    const loaded = await loadLeadConversation(leadId)
    if (!loaded) {
      return { leadId, outcome: 'error', error: 'lead_not_found' }
    }

    const { lead, context } = loaded

    if (isAiPausedStatus(lead.status)) {
      conversationLog('conversation.turn.skip', { leadId, reason: 'ai_paused', status: lead.status })
      return { leadId, outcome: 'skipped_paused' }
    }

    if (!lead.threadId) {
      conversationLog('conversation.turn.skip', { leadId, reason: 'no_thread' })
      return { leadId, outcome: 'skipped_no_thread' }
    }

    const scrapedReply = options.scrapedHostReply?.trim() || null
    const lastInbound = lastHostReplyForTurn(context.recentMessages)
    const hostText = scrapedReply || lastInbound?.content?.trim() || ''
    if (!hostText) {
      conversationLog('conversation.turn.skip', { leadId, reason: 'no_inbound' })
      return { leadId, outcome: 'skipped_no_inbound' }
    }

    if (scrapedReply) {
      conversationLog('conversation.host_reply.source', {
        leadId,
        source: 'airbnb_scrape',
        preview: scrapedReply.slice(0, 120),
      })
    }

    const classification = classifyHostReply(hostText)
    const aiTag = intentToAiTag(classification.intent)

    conversationLog('conversation.reply_intent', {
      leadId,
      intent: classification.intent,
      pattern: classification.matchedPattern,
      preview: hostText.slice(0, 120),
    })

    await tagLatestInboundIntent(leadId, aiTag)

    if (classification.intent === 'rejected') {
      await applyCloseLost(
        leadId,
        `Rechazo detectado (${classification.matchedPattern ?? 'regex'}): ${hostText.slice(0, 200)}`,
      )
      conversationLog('conversation.close_lost', { leadId, reason: 'regex_rejection' })
      return { leadId, outcome: 'closed_lost', intent: aiTag }
    }

    const curiositySent = alreadySentCuriosityReply(context.recentMessages)

    if (curiositySent) {
      if (isMeetingAffirmative(hostText)) {
        await applyHumanTakeover(
          leadId,
          `Host aceptó reunión tras mensaje de curiosidad: "${hostText.slice(0, 200)}"`,
        )
        conversationLog('conversation.meeting_accepted', { leadId })
        return { leadId, outcome: 'human_takeover', intent: 'REUNION_ACEPTADA' }
      }

      conversationLog('conversation.turn.skip', {
        leadId,
        reason: 'curiosity_already_sent',
      })
      return { leadId, outcome: 'skipped_already_replied', intent: aiTag }
    }

    // interested (explícito o dry_default_listen). ambiguous solo si texto vacío.
    if (classification.intent !== 'interested') {
      conversationLog('conversation.turn.skip', {
        leadId,
        reason: 'empty_or_unclassified',
      })
      return { leadId, outcome: 'skipped_ambiguous', intent: aiTag }
    }

    const replyText = buildCuriosityReplyMessage(lead)
    const sendResult = await sendThreadOutboundMessage(
      page,
      lead,
      replyText,
      'CURIOSITY_REPLY',
    )

    if (!sendResult.success) {
      conversationLog('conversation.send.failed', { leadId, error: sendResult.error })
      return { leadId, outcome: 'error', intent: aiTag, error: sendResult.error }
    }

    await recordBotReply(leadId, replyText, 'CURIOSITY_REPLY')
    conversationLog('conversation.send.success', { leadId, template: 'CURIOSITY_REPLY' })
    conversationLog('conversation.turn.complete', {
      leadId,
      outcome: 'replied',
      pattern: classification.matchedPattern,
    })

    return { leadId, outcome: 'replied', intent: aiTag }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    conversationLog('conversation.error', { leadId, error: message })
    await notifyAgentError('conversation', message, { leadId })
    return { leadId, outcome: 'error', error: message }
  }
}
