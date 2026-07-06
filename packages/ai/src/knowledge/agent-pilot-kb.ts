/**
 * Base de conocimiento comercial de Agent Pilot (L0 inline + L1 prefetch).
 *
 * El Negociador NO debe inventar capacidades. Solo puede afirmar lo que está
 * aquí. Cada entrada tiene un `summary` corto (verbatim para el prompt) y un
 * patrón de keywords para el prefetch determinístico (Capa C).
 */

export type KbEntry = {
  topic: string
  summary: string
  keywords: RegExp
}

export const AGENT_PILOT_KB: KbEntry[] = [
  {
    topic: 'huespedes',
    summary:
      'Asistente 24/7 que responde a huéspedes por chat (cualquier idioma): check-in, normas, recomendaciones y dudas frecuentes.',
    keywords: /hu[eé]sped|\bguest\b|respuesta|chat|check-?in|mensaj|atenci[oó]n|24\/7/i,
  },
  {
    topic: 'limpieza',
    summary:
      'Portal de limpiezas que coordina al equipo de aseo en cascada entre reservas, con tareas y confirmaciones automáticas.',
    keywords: /limpiez|aseo|cleaning|turnover|camarera|housekeep|aseador/i,
  },
  {
    topic: 'bodega',
    summary:
      'Coordinación de bodega, lencería e inventario para reponer amenities y blancos sin quiebres de stock.',
    keywords: /bodega|lencer|inventario|amenit|stock|blancos|toallas|s[aá]banas/i,
  },
  {
    topic: 'gastos',
    summary:
      'Gestión de gastos: captura facturas y categoriza costos por propiedad para control financiero.',
    keywords: /gasto|factur|costo|contab|finanz|expense|recibo/i,
  },
  {
    topic: 'bi',
    summary:
      'BI de ocupación, facturación y demanda: predice ocupación y consolida métricas por listado.',
    keywords: /ocupaci|demanda|m[eé]tric|reporte|\bbi\b|dashboard|datos|analyt|pricing|tarifa/i,
  },
  {
    topic: 'integraciones',
    summary:
      'Se integra con tus canales y PMS (p. ej. Guesty, Hostaway) para operar todo desde un solo lugar.',
    keywords: /integr|\bpms\b|guesty|hostaway|\bapi\b|channel|sincron|conect/i,
  },
  {
    topic: 'propuesta',
    summary:
      'Propuesta comercial: piloto corto y diagnóstico gratuito de cuellos de botella, sin compromiso largo.',
    keywords: /precio|costo|cu[aá]nto|piloto|diagn|prueba|demo|\bplan\b|onboarding|implementaci/i,
  },
]

/**
 * Prefetch determinístico (Capa C): keywords del texto -> entradas de KB.
 * Máximo `max` entradas por turno para no inflar el prompt.
 */
export function prefetchKnowledge(text: string, max = 3): KbEntry[] {
  if (!text?.trim()) return []
  const matches = AGENT_PILOT_KB.filter((entry) => entry.keywords.test(text))
  return matches.slice(0, max)
}

export function formatKnowledgeBlock(entries: KbEntry[]): string {
  if (entries.length === 0) return ''
  const lines = entries.map((e) => `- ${e.topic}: ${e.summary}`)
  return `CONOCIMIENTO RELEVANTE (usa SOLO esto, no inventes capacidades):\n${lines.join('\n')}`
}
