import type { TriageResult } from '@repo/ai'

/**
 * Reglas determinísticas del turno conversacional. Aisladas en un módulo puro
 * (sin Playwright ni DB) para poder testearlas de forma unitaria.
 */

/**
 * "Momento debido" para enviar Cal.com:
 *  - Solo si el host mostró interés o hizo una pregunta (INTERESADO/DUDA_TECNICA).
 *  - Nunca si ya se envió antes (evita spam; el kill switch gobierna el resto).
 */
export function isCalLinkDue(
  intent: TriageResult['intent'],
  calLinkSent: boolean,
): boolean {
  if (calLinkSent) return false
  return intent === 'INTERESADO' || intent === 'DUDA_TECNICA'
}

/** El triaje recomienda cierre por rechazo explícito. */
export function shouldCloseLost(triage: TriageResult): boolean {
  return triage.intent === 'RECHAZO'
}

/**
 * Escalar a humano por baja confianza cuando ya se envió el link (señal de
 * negociación que el bot no debe forzar).
 */
export function shouldEscalateLowConfidence(
  triage: TriageResult,
  calLinkSent: boolean,
): boolean {
  return triage.confidence === 'low' && calLinkSent
}
