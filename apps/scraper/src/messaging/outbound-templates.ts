import type { Lead } from '@repo/db'
import type { OutboundPhase } from '../persistence/outbound-pipeline'
import { isColdLeadEligible } from '../persistence/outbound-pipeline'
import { buildCalComLinkForLead, getCalComBaseLink } from './cal-link'

export type SuperhostGender = 'female' | 'male'

/** Resuelve "superanfitrión" vs "superanfitriona" (heurística por nombre si no hay género). */
export function resolveSuperhostTitle(
  name: string,
  gender?: SuperhostGender | null,
): string {
  if (gender === 'female') return 'superanfitriona'
  if (gender === 'male') return 'superanfitrión'

  const first = (name.split(' ')[0] ?? name).toLowerCase()
  const masculineEndingA = new Set(['joshua', 'luca', 'borja', 'nicola', 'garcia', 'sasha'])
  if (first.endsWith('a') && !masculineEndingA.has(first)) return 'superanfitriona'
  return 'superanfitrión'
}

export type TemplateVars = {
  name: string
  superhostTitle: string
  primaryListingName: string
  totalProperties: number
  calComLink: string
}

export type BuildTemplateOptions = {
  superhostGender?: SuperhostGender | null
}

export function buildTemplateVars(
  lead: Lead,
  options: BuildTemplateOptions = {},
): TemplateVars {
  const name = lead.name.split(' ')[0] || lead.name
  return {
    name,
    superhostTitle: resolveSuperhostTitle(lead.name, options.superhostGender),
    primaryListingName: lead.primaryListingName ?? 'tu anuncio',
    totalProperties: lead.totalProperties,
    calComLink: buildCalComLinkForLead(lead.id),
  }
}

const TEMPLATES: Record<OutboundPhase, (v: TemplateVars) => string> = {
  PHASE_1_COLD: (v) =>
    `¡Hola ${v.name}! Noté que eres ${v.superhostTitle}. Hemos implementado en Property Managers como tu un sistema que libera más de 100 horas semanales, recupera caja que se pierde y aumenta reseñas positivas de tus huéspedes. ¿Tienes 5 minutos para comentarte qué es y cómo funciona?`,

  PHASE_2_OPS: (v) =>
    `Hola ${v.name}, te escribí hace unos días sobre el sistema que usan Property Managers como tú para liberar más de 100 horas semanales. ¿Tienes 5 minutos para contarte en qué consiste?`,

  PHASE_3_BI: (v) =>
    `¿Pudiste ver mi mensaje, ${v.name}? Muchos ${v.superhostTitle === 'superanfitriona' ? 'superanfitrionas' : 'superanfitriones'} con operaciones como la tuya recuperan caja y mejoran reseñas con una sola plataforma. ¿Te interesa saber más?`,

  PHASE_4_BREAKUP: (v) =>
    `Hola ${v.name}, este es mi último mensaje. Si en algún momento quieres ver cómo se adaptaría a tu operación, avísame. ¡Mucho éxito con tus reservas!`,
}

/** Respuesta estática cuando el host muestra curiosidad (Triaje → INTERESADO / DUDA_TECNICA). */
const CURIOSITY_REPLY = (v: TemplateVars) =>
  `Excelente, te comento!
Entendimos que el mayor reto al manejar varias propiedades es que la logística no te consuma el día a día o tengas que tener un equipo gigante. Somos una agencia de software e infraestructura de IA en donde creamos una sola plataforma que orquesta huéspedes, limpiezas, inventario, guest-report y finanzas. El sistema es orquestado por IA, lo que se traduce en liberar horas a la semana, dar un mejor servicio y que tu empresa ande sola.

Hay mucho más detrás y todo es personalizado, pero prefiero mostrártelo operando y los casos de uso de nuestros clientes. ¿Tendrías 10-15 min mañana para que veas cómo se adaptaría a tu operación?`

export function buildOutboundMessage(
  lead: Lead,
  phase: OutboundPhase,
  options: BuildTemplateOptions = {},
): string {
  if (phase === 'PHASE_1_COLD' && !isColdLeadEligible(lead)) {
    throw new Error('Cold outbound blocked: lead does not meet ICP requirements')
  }

  const vars = buildTemplateVars(lead, options)
  return TEMPLATES[phase](vars)
}

export function buildCuriosityReplyMessage(
  lead: Lead,
  options: BuildTemplateOptions = {},
): string {
  const vars = buildTemplateVars(lead, options)
  return CURIOSITY_REPLY(vars)
}

export function getCalComLink(leadId?: string): string {
  if (leadId) return buildCalComLinkForLead(leadId)
  return getCalComBaseLink()
}
