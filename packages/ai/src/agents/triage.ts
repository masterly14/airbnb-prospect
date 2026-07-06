import { z } from 'zod'
import { completeJson } from '../client.js'
import {
  formatHistory,
  formatLeadFacts,
  lastInboundMessage,
  type LeadAgentContext,
} from '../context/lead-context.js'

export const triageOutputSchema = z.object({
  intent: z.enum(['INTERESADO', 'DUDA_TECNICA', 'RECHAZO', 'AMBIGUO']),
  confidence: z.enum(['high', 'medium', 'low']),
  reason: z.string().min(3),
  shouldCloseLead: z.boolean(),
  shouldInvokeNegotiator: z.boolean(),
  shouldHumanTakeover: z.boolean(),
})

export type TriageResult = z.infer<typeof triageOutputSchema>

const SYSTEM_PROMPT = `Eres el Agente de Triaje interno de Agent Pilot, un sistema de prospección B2B para administradores de rentas cortas en Airbnb.

Tu único trabajo es clasificar la ÚLTIMA respuesta del host para decidir el siguiente paso del pipeline. NO redactas el mensaje final. NO incluyes Cal.com. Solo clasificas.

Clases (intent):
- INTERESADO: el host muestra curiosidad, pide más información o abre la puerta a conversar.
- DUDA_TECNICA: pregunta por integraciones, funcionamiento, precio, alcance o implementación.
- RECHAZO: expresa que no le interesa, pide no continuar, o responde con hostilidad.
- AMBIGUO: respuesta insuficiente, fuera de tema o que no permite clasificar con seguridad.

Devuelve SOLO JSON válido con estas claves:
- intent: una de las clases anteriores.
- confidence: "high" | "medium" | "low".
- reason: 1 frase breve en español que justifique la clasificación.
- shouldCloseLead: true solo si hay RECHAZO explícito.
- shouldInvokeNegotiator: true si hay INTERESADO o DUDA_TECNICA.
- shouldHumanTakeover: true si la conversación es comercialmente compleja o la confianza es baja.

Responde SOLO con JSON válido, en español, sin markdown.`

function buildUserPrompt(ctx: LeadAgentContext): string {
  const lastInbound = lastInboundMessage(ctx)
  const parts = [
    formatLeadFacts(ctx),
    formatHistory(ctx),
    `ESTADO ACTUAL DEL LEAD: ${ctx.lead.status}`,
    `ÚLTIMA RESPUESTA DEL HOST A CLASIFICAR:\n${lastInbound?.content ?? '(sin mensaje del host)'}`,
  ]
  return parts.join('\n\n')
}

export async function runTriage(ctx: LeadAgentContext): Promise<TriageResult> {
  return completeJson(SYSTEM_PROMPT, buildUserPrompt(ctx), triageOutputSchema)
}
