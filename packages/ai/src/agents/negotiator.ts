import { z } from 'zod'
import { completeJson } from '../client.js'
import {
  buildBriefing,
  firstName,
  formatBriefing,
  formatHistory,
  formatLeadFacts,
  lastInboundMessage,
  type LeadAgentContext,
} from '../context/lead-context.js'
import {
  formatKnowledgeBlock,
  prefetchKnowledge,
} from '../knowledge/agent-pilot-kb.js'
import type { TriageResult } from './triage.js'

export const negotiatorOutputSchema = z.object({
  message: z.string().min(1),
  includesCalLink: z.boolean(),
  shouldHumanTakeover: z.boolean(),
  shouldCloseLost: z.boolean(),
  aiIntent: z.string().min(1),
})

export type NegotiatorResult = z.infer<typeof negotiatorOutputSchema>

export type NegotiatorOptions = {
  /** El "momento debido": true cuando el sistema autoriza enviar el link. */
  calLinkAllowed: boolean
  /** Link de Cal.com ya sin protocolo (ej. cal.com/agent-pilot?...). */
  calLink: string
}

const SYSTEM_PROMPT = `Eres el Agente Negociador de Agent Pilot. Tu único objetivo es mover al host de Airbnb hacia una llamada corta de diagnóstico.

No vendes a profundidad ni explicas todo el producto. Das UN bocado de valor conectado al contexto del host y propones la llamada.

Reglas duras:
1. No des explicaciones largas. Una sola idea de valor concreta.
2. Responde la duda del host usando SOLO el conocimiento que se te entrega; no inventes integraciones, precios ni resultados.
3. Máximo UNA pregunta o llamada a la acción.
4. Sin listas, sin markdown.
5. El link de Cal.com solo puede aparecer si "MOMENTO_DEBIDO" es true. Si lo incluyes, usa exactamente el link entregado SIN https://.
6. Longitud acorde al mensaje del host (mensajes breves).
7. Tono humano y cálido, en español de Colombia.

Devuelve SOLO JSON válido con estas claves:
- message: el texto a enviar al host (sin markdown, sin https://).
- includesCalLink: true si incluiste el link de Cal.com.
- shouldHumanTakeover: true si la conversación supera lo que puedes resolver (negociación compleja, precio detallado de gran cuenta, etc.).
- shouldCloseLost: true si tras tu lectura el host claramente no quiere continuar.
- aiIntent: etiqueta corta de la intención de tu respuesta (ej. "Responde duda de integración", "Invita a agendar").

Responde SOLO con JSON válido, en español, sin markdown.`

function buildUserPrompt(
  ctx: LeadAgentContext,
  triage: TriageResult,
  options: NegotiatorOptions,
): string {
  const lastInbound = lastInboundMessage(ctx)
  const knowledge = prefetchKnowledge(lastInbound?.content ?? '', 3)
  const briefing = buildBriefing(ctx)

  const parts = [
    formatLeadFacts(ctx),
    formatBriefing(briefing),
    formatKnowledgeBlock(knowledge),
    formatHistory(ctx),
    `CLASIFICACIÓN DEL TRIAJE: intent=${triage.intent}, confidence=${triage.confidence}. Motivo: ${triage.reason}`,
    `ÚLTIMA RESPUESTA DEL HOST:\n${lastInbound?.content ?? '(sin mensaje del host)'}`,
    `MOMENTO_DEBIDO (puedes enviar el link): ${options.calLinkAllowed ? 'true' : 'false'}`,
    options.calLinkAllowed
      ? `LINK DE CAL.COM A USAR (sin https://): ${options.calLink}`
      : 'NO incluyas ningún link de Cal.com en este turno.',
    `Dirígete al host por su nombre: ${firstName(ctx)}.`,
  ].filter(Boolean)

  return parts.join('\n\n')
}

export async function runNegotiator(
  ctx: LeadAgentContext,
  triage: TriageResult,
  options: NegotiatorOptions,
): Promise<NegotiatorResult> {
  return completeJson(
    SYSTEM_PROMPT,
    buildUserPrompt(ctx, triage, options),
    negotiatorOutputSchema,
  )
}
