/**
 * Clasificación determinística de respuestas del host (sin LLM).
 * Prioridad: rechazo → interés explícito → interés por defecto (respuesta seca).
 *
 * En prospección Airbnb los hosts suelen responder seco ("Si", "Hola", "Ok",
 * "Recibido"). Eso NO es ambigüedad operativa: es luz verde para el mensaje 2.
 * Solo el rechazo explícito corta el auto-reply.
 */

export type HostReplyIntent = 'interested' | 'rejected' | 'ambiguous'

export type HostReplyClassification = {
  intent: HostReplyIntent
  matchedPattern?: string
}

/** Respuestas que indican que no quieren continuar. */
const REJECTION_PATTERNS: Array<{ label: string; re: RegExp }> = [
  // Negación corta / sola (muy común en Airbnb: "No")
  { label: 'no_solo', re: /^(no|nop|nope|nel|nah)(?:\s*[.!?,…👎❌]*)?$/i },
  { label: 'no_punto', re: /^no\s*[.!]+$/i },

  // Negación directa
  { label: 'no_gracias', re: /\bno\s*,?\s*gracias\b/i },
  { label: 'no_me_interesa', re: /\bno\s+me\s+interesa\b/i },
  { label: 'no_estoy_interesado', re: /\bno\s+estoy\s+interesad[oa]\b/i },
  { label: 'no_tengo_interes', re: /\bno\s+tengo\s+inter[eé]s\b/i },
  { label: 'sin_interes', re: /\bsin\s+inter[eé]s\b/i },
  { label: 'no_quiero', re: /\bno\s+quiero\b/i },
  { label: 'no_deseo', re: /\bno\s+deseo\b/i },
  { label: 'no_busco', re: /\bno\s+(estoy\s+)?buscando\b/i },

  // Timing / aplazamiento = no
  { label: 'no_por_ahora', re: /\bno\s+por\s+(ahora|el\s+momento|esta\s+vez)\b/i },
  { label: 'ahora_no', re: /\bahora\s+no\b/i },
  { label: 'de_momento_no', re: /\bde\s+(momento|entrada)\s+no\b/i },
  { label: 'por_ahora_no', re: /\bpor\s+ahora\s+no\b/i },
  { label: 'en_otro_momento_no', re: /\ben\s+otro\s+momento\s+no\b/i },

  // Cortesía que esconde un no
  { label: 'gracias_pero_no', re: /\bgracias\s*,?\s*pero\s+no\b/i },
  { label: 'gracias_igual', re: /\bgracias\s+igual\b/i },
  { label: 'ok_gracias', re: /\bok\s*,?\s*gracias\b/i },
  { label: 'gracias_estoy_bien', re: /\bgracias\s*,?\s*(estoy\s+bien|todo\s+bien)\b/i },
  { label: 'estoy_bien_gracias', re: /\b(estoy\s+bien|todo\s+bien)\s*,?\s*gracias\b/i },
  { label: 'prefiero_no', re: /\bprefiero\s+no\b/i },

  // Límites / bloqueo
  { label: 'dejame_tranquilo', re: /\b(d[eé]jame|dejame)\s+tranquil[oa]?\b/i },
  { label: 'no_molesten', re: /\bno\s+(me\s+)?molest/i },
  { label: 'no_contactar', re: /\bno\s+(me\s+)?contact/i },
  { label: 'no_escribas', re: /\bno\s+(me\s+)?escrib/i },
  { label: 'dejen_de_escribir', re: /\bdejen\s+de\s+escribir\b/i },
  { label: 'no_insistan', re: /\bno\s+insist/i },

  // No necesita / ya tiene solución
  { label: 'no_necesito', re: /\bno\s+(lo\s+)?necesito\b/i },
  { label: 'no_requiero', re: /\bno\s+(lo\s+)?requiero\b/i },
  { label: 'no_es_necesario', re: /\bno\s+es\s+necesario\b/i },
  { label: 'ya_tengo', re: /\bya\s+tengo(\s+(un\s+)?(sistema|software|proveedor|equipo|herramienta))?\b/i },
  { label: 'ya_cuenta_con', re: /\bya\s+cuent[o]?\s+con\b/i },
  { label: 'no_aplica', re: /\bno\s+(me\s+)?aplica\b/i },
  { label: 'no_es_para_mi', re: /\bno\s+es\s+para\s+m[ií]\b/i },
  { label: 'no_me_convence', re: /\bno\s+me\s+convence\b/i },

  // Rechazo coloquial
  { label: 'paso', re: /\bpaso\b/i },
  { label: 'ni_hablar', re: /\bni\s+hablar\b/i },
  { label: 'ni_de_chiste', re: /\bni\s+de\s+chiste\b/i },
  { label: 'olvidalo', re: /\bolv[ií]d(a|alo|elo)\b/i },
  { label: 'no_vendas', re: /\bno\s+(me\s+)?vend/i },
  { label: 'spam', re: /\b(spam|publicidad\s+no\s+solicitada|correo\s+no\s+deseado)\b/i },

  // Inglés frecuente
  { label: 'no_thanks_en', re: /\bno\s+thanks?\b/i },
  { label: 'not_interested_en', re: /\bnot\s+interested\b/i },
  { label: 'stop_en', re: /\b(stop|unsubscribe|leave\s+me\s+alone)\b/i },
]

/** Respuestas que abren la puerta a enviar el mensaje 2 (curiosidad). */
const INTEREST_PATTERNS: Array<{ label: string; re: RegExp }> = [
  // Afirmación corta / seca (muy común en hosts)
  { label: 'si_solo', re: /^(s[ií]|sip|sep|sim)(?:\s*[.!?,…👍✅]*)?$/i },
  { label: 'ok_solo', re: /^(ok|okay|vale|va|listo|bien)(?:\s*[.!?,…]*)?$/i },
  { label: 'saludo', re: /^(hola|buenas?|buen\s+(d[ií]a|tarde|noches)|hey|hi)\b/i },
  { label: 'saludo_nombre', re: /^hola[\s,]+[\p{L}'-]{2,}/iu },
  { label: 'ack_seco', re: /^(recibido|entendido|de\s+acuerdo|okey|oka)(?:\s*[.!?,…]*)?$/i },

  // Afirmación / luz verde coloquial (CO)
  { label: 'dale', re: /\bdale\b/i },
  { label: 'adelante', re: /\badelante\b/i },
  { label: 'prosigue', re: /\b(prosigue|contin[uú]a|sigue)\b/i },
  { label: 'afirmacion', re: /\b(claro|perfecto|listo|excelente|genial|bueno|bacano|ch[eé]vere|b[aá]rbaro)\b/i },
  { label: 'por_supuesto', re: /\b(por\s+supuesto|desde\s+luego|obvio|seguro)\b/i },
  { label: 'claro_que_si', re: /\bclaro\s+que\s+s[ií]\b/i },
  { label: 'si_ok', re: /\b(s[ií]|ok|okay|vale|sim|yep|sure)\b/i },

  // Pedir que cuenten / expliquen
  { label: 'cuentame', re: /\b(cu[eé]ntame|com[eé]ntame|cu[eé]ntenos|com[eé]ntenos)\b/i },
  { label: 'cuentame_mas', re: /\b(cu[eé]ntame|com[eé]ntame)\s+(m[aá]s|un\s+poco|sobre|en\s+qu[eé]\s+consiste)\b/i },
  { label: 'hablame', re: /\b(h[aá]blame|h[aá]blenos|charlemos|conversemos|hablemos)\b/i },
  { label: 'dime_mas', re: /\b(d[ií]me|d[ií]ganme)\s+m[aá]s\b/i },
  { label: 'a_ver', re: /\ba\s+ver\b/i },
  { label: 'mostrarme', re: /\b(m[uú]estra(me|nos)?|mostr[aá]me|expl[ií]ca(me|nos)?|expl[ií]queme)\b/i },
  { label: 'mas_info', re: /\b(m[aá]s\s+(info(rmaci[oó]n)?|detalles|datos)|info(rmaci[oó]n)?\s+por\s+favor)\b/i },
  { label: 'envia_info', re: /\b(m[aá]ndame|m[aá]ndenos|env[ií]ame|env[ií]enos|p[aá]same|p[aá]senme)\s+(la\s+)?(info|informaci[oó]n|detalles)\b/i },

  // Curiosidad / interés explícito
  { label: 'me_interesa', re: /\b(me\s+interesa|tengo\s+inter[eé]s|estoy\s+interesad[oa])\b/i },
  { label: 'suena_bien', re: /\b(suena\s+(bien|interesante|chevere|bacano)|me\s+suena\s+bien)\b/i },
  { label: 'interesante', re: /\b(interesante|me\s+llama\s+la\s+atenci[oó]n|me\s+parece\s+interesante)\b/i },
  { label: 'quisiera_saber', re: /\b(me\s+gustar[ií]a|quisiera)\s+(saber|conocer|escuchar|entender)\b/i },
  { label: 'me_gustaria', re: /\bme\s+gustar[ií]a\s+(saber|conocer|que\s+me\s+cuent)/i },

  // Preguntas sobre producto (= interés)
  { label: 'como_funciona', re: /\b(c[oó]mo\s+funciona|c[oó]mo\s+es|qu[eé]\s+es|de\s+qu[eé]\s+se\s+trata|en\s+qu[eé]\s+consiste)\b/i },
  { label: 'que_ofrecen', re: /\b(qu[eé]\s+(ofrecen|incluye|hacen|venden|propone|es\s+eso))\b/i },
  { label: 'como_ayuda', re: /\b(c[oó]mo\s+(me\s+)?ayudar[ií]a|en\s+qu[eé]\s+me\s+beneficia|qu[eé]\s+ventajas)\b/i },
  { label: 'precio', re: /\b(cu[aá]nto\s+cuesta|cu[aá]l\s+es\s+el\s+(precio|costo|valor)|tiene\s+costo)\b/i },
  { label: 'demo', re: /\b(demo|demostraci[oó]n|prueba|m[uú]estra(me)?\s+la\s+plataforma)\b/i },
  { label: 'pregunta', re: /\?/ },

  // Tiempo / disposición inicial (aún no es reunión confirmada)
  { label: 'tiempo', re: /\b(5\s+minutos|tengo\s+(tiempo|un\s+rato|disponibilidad)|puedo\s+escuchar)\b/i },

  // Inglés frecuente
  { label: 'tell_me_more_en', re: /\b(tell\s+me\s+more|go\s+ahead|sounds?\s+good|interested|yes\s+please)\b/i },
  { label: 'lets_talk_en', re: /\blet['']?s\s+talk\b/i },
]

/** Tras el mensaje 2: el host acepta agendar (notificar admin). */
const MEETING_AFFIRMATIVE_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: 'si_manana', re: /\b(s[ií]|claro|perfecto|dale|listo).{0,40}(ma[nñ]ana|hoy|tarde|esta\s+semana)\b/i },
  { label: 'agendar', re: /\b(agend(a|emos|ar)|reuni[oó]n|llamada|videollamada|meet|zoom|teams|google\s+meet)\b/i },
  { label: 'me_parece_bien', re: /\bme\s+parece(\s+bien|\s+perfecto|\s+genial)\b/i },
  { label: 'disponible', re: /\b(estoy\s+)?disponible(\s+(ma[nñ]ana|hoy|en\s+la\s+tarde))?\b/i },
  { label: 'horario', re: /\b(a\s+las\s+)?\d{1,2}(:\d{2})?\s*(am|pm|a\.?\s*m\.?)?\b/i },
  { label: 'confirmo', re: /\b(confirmo|confirmado|cuenta\s+conmigo|nos\s+vemos|hablamos\s+ma[nñ]ana)\b/i },
  { label: 'acepto', re: /\b(acepto|de\s+acuerdo|trato\s+hecho|hag[aá]moslo)\b/i },
  { label: 'calendario', re: /\b(calendario|calendar|slot|espacio\s+en\s+la\s+agenda)\b/i },
]

function matchFirst(text: string, patterns: Array<{ label: string; re: RegExp }>) {
  for (const { label, re } of patterns) {
    if (re.test(text)) return label
  }
  return null
}

/**
 * True si la respuesta del host debe disparar el mensaje 2 (curiosidad).
 * Rechazo = no. Cualquier otro texto real del host = sí.
 */
export function shouldSendCuriosityReply(intent: HostReplyIntent): boolean {
  return intent === 'interested'
}

export function classifyHostReply(text: string): HostReplyClassification {
  const normalized = text.trim().replace(/\s+/g, ' ')
  if (!normalized) {
    return { intent: 'ambiguous' }
  }

  const rejection = matchFirst(normalized, REJECTION_PATTERNS)
  if (rejection) {
    return { intent: 'rejected', matchedPattern: rejection }
  }

  const interest = matchFirst(normalized, INTEREST_PATTERNS)
  if (interest) {
    return { intent: 'interested', matchedPattern: interest }
  }

  // Default de industria: respuesta seca / no-rechazo = quiere escuchar.
  return { intent: 'interested', matchedPattern: 'dry_default_listen' }
}

export function isMeetingAffirmative(text: string): boolean {
  return matchFirst(text.trim(), MEETING_AFFIRMATIVE_PATTERNS) !== null
}

/** Etiqueta CRM alineada con el dashboard histórico. */
export function intentToAiTag(intent: HostReplyIntent): string {
  switch (intent) {
    case 'interested':
      return 'INTERESADO'
    case 'rejected':
      return 'RECHAZO'
    default:
      return 'AMBIGUO'
  }
}
