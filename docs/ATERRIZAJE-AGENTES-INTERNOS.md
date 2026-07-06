# Documento de aterrizaje — Agentes internos Agent Pilot

Documento guía para construir los agentes internos del sistema de prospección de Agent Pilot. Consolida la especificación comercial de `apps/web/docs/system.md`, el estado actual del proyecto en `docs/ESTADO-PROYECTO.md` y el patrón técnico de agentes descrito en `docs/especificacion-agentes/agent-prompt.md` y `docs/especificacion-agentes/agent-architecture.md`.

---

## 1. Norte del sistema

Agent Pilot no necesita un chatbot genérico. Necesita un sistema de prospección que descubra anfitriones de Airbnb, los cualifique, converse con ellos con mensajes breves y mueva cada lead hacia una única conversión: agendar una llamada de diagnóstico por Cal.com.

La regla de diseño central es:

> El LLM redacta; el sistema gobierna.

Esto significa que los agentes no deciden solos el pipeline, los tiempos, los estados ni las reglas anti-spam. El sistema les entrega contexto, limita sus acciones, valida su salida y persiste cada transición en el CRM.

---

## 2. Estado actual desde el cual se construye

### Construido

- Monorepo con workspaces `apps/*` y `packages/*`.
- Prisma compartido en `packages/db` con modelos `Lead`, `Message` y `SystemState`.
- Neon Postgres conectado como fuente de verdad.
- Scraper Playwright capaz de autenticar en Airbnb, buscar listings, entrar a perfiles de anfitrión y hacer `upsert` de leads.
- Deduplicación por `hostAirbnbId`, no por propiedad.
- Campos base del CRM ya disponibles: `totalProperties`, `status`, `businessScale`, `painPoints`, `executiveSummary`, `threadId`, `botReplyCount`, `calLinkSent`, `lastContactedAt`, `nextFollowUpAt`.
- Estados del pipeline ya definidos en `LeadStatus`.

### Pendiente

- Agente Perfilador para enriquecer leads durante el harvest.
- Worker Outbound para primer contacto y follow-ups.
- Worker Inbound para polling del inbox de Airbnb.
- Agente de Triaje para clasificar respuestas del host.
- Agente Negociador para responder objeciones cortas y enviar Cal.com en el momento debido.
- Mutex Playwright usando `SystemState`.
- API y dashboard operativo en `apps/web`.
- Observabilidad, alertas y métricas de conversión.

---

## 3. Agentes internos a construir

### 3.1 Agente Perfilador

Corre durante el descubrimiento/enriquecimiento de leads.

**Entrada mínima:**

- `hostAirbnbId`
- `name`
- `hostProfileUrl`
- `primaryListingUrl`
- `primaryListingName`
- `totalProperties`
- Descripción pública del host
- Señales de listings, amenities, reseñas o contenido extraído del perfil cuando estén disponibles

**Salida esperada:**

- `businessScale`: lectura del tamaño y madurez del operador.
- `painPoints`: hipótesis concretas de dolores operativos observables.
- `executiveSummary`: resumen interno para el dashboard y para personalizar el primer mensaje.

**Reglas:**

- No inventar datos que no estén en el perfil, listing, reseñas o HAR/DOM extraído.
- Separar hechos observados de inferencias comerciales.
- Usar `totalProperties` como palanca principal.
- Dejar campos vacíos o marcados como inciertos cuando la señal no exista.

**Persistencia:**

- Actualiza el `Lead` existente.
- No avanza estados de conversación.
- No envía mensajes.

---

### 3.2 Agente de Triaje

Corre cuando el módulo Inbound detecta una respuesta del host.

**Entrada mínima:**

- Lead hidratado desde Prisma.
- Último mensaje inbound.
- Historial reciente en `Message`.
- Estado actual del lead.
- Si `calLinkSent` ya es `true`.
- `botReplyCount`.

**Clasificaciones iniciales:**

- `INTERESADO`: el host muestra curiosidad, pide más información o abre la puerta a conversar.
- `DUDA_TECNICA`: pregunta por integraciones, funcionamiento, precio, alcance o implementación.
- `RECHAZO`: expresa que no le interesa o pide no continuar.
- `AMBIGUO`: respuesta insuficiente que requiere una réplica corta o intervención humana según contexto.

**Salida esperada:**

```ts
type TriageResult = {
  intent: 'INTERESADO' | 'DUDA_TECNICA' | 'RECHAZO' | 'AMBIGUO'
  confidence: 'high' | 'medium' | 'low'
  reason: string
  shouldCloseLead: boolean
  shouldInvokeNegotiator: boolean
  shouldHumanTakeover: boolean
}
```

**Reglas:**

- Si hay rechazo explícito, cerrar como `CLOSED_LOST`.
- Si hay interés o duda técnica, pasar al Negociador.
- Si la confianza es baja y el lead ya recibió el link o hay complejidad comercial, preferir `HUMAN_TAKEOVER`.
- El triaje clasifica; no redacta el mensaje final.

---

### 3.3 Agente Negociador

Es el closer conversacional orientado a Cal.com. No vende a profundidad y no explica todo Agent Pilot. Da un bocado de valor, conecta con el contexto del host y propone llamada.

**Entrada mínima:**

- Lead hidratado.
- Resultado del Agente de Triaje.
- Último mensaje inbound.
- Historial reciente.
- Base de conocimiento comercial de Agent Pilot.
- Estado de `calLinkSent` y `botReplyCount`.

**Base de conocimiento inicial:**

- Asistente 24/7 para huéspedes.
- Portal de limpiezas.
- Coordinación de bodega/lencería.
- Gestión de gastos.
- BI de ocupación, facturas y demanda.
- Propuesta comercial: piloto y diagnóstico corto.

**Regla del momento debido:**

El link de Cal.com solo puede enviarse:

1. Cuando el host ya respondió con interés, curiosidad o una pregunta.
2. En el follow-up final de break-up.

Nunca se envía en el mensaje frío de Fase 1 ni en los follow-ups intermedios.

**Formato del link:**

- Usar `cal.com/agent-pilot` o el slug configurado.
- No usar `https://`.

**Estilo de respuesta:**

- Máximo una idea de valor antes del link.
- Una sola pregunta o llamada a la acción.
- Sin explicaciones largas.
- Sin listas.
- Sin promesas no soportadas por producto.
- Longitud acorde al input del host.

**Kill switch:**

- Tras enviar Cal.com, la IA puede responder como máximo 2 veces más.
- Si el host responde una tercera vez sin agendar, cambiar a `HUMAN_TAKEOVER` y alertar al equipo.
- Cada respuesta del bot incrementa `botReplyCount`.

---

## 4. Workers y módulos que orquestan a los agentes

### 4.1 Harvester

Responsable de descubrir hosts y crear leads.

Flujo:

1. Buscar listings en Airbnb.
2. Entrar a perfiles de host.
3. Extraer `hostAirbnbId`, nombre, URLs, listing principal y `totalProperties`.
4. Hacer `db.lead.upsert`.
5. Invocar Agente Perfilador si hay datos suficientes.
6. Mantener estado inicial `LEAD_DISCOVERED`.

### 4.2 Outbound

Responsable de primer contacto y follow-ups.

Flujo:

1. Leer leads elegibles por `status` y `nextFollowUpAt <= now`.
2. Tomar mutex Playwright.
3. Abrir Airbnb y enviar mensaje con tipeo humano usando `page.type(..., { delay: 45 })`.
4. Persistir `Message(OUTBOUND)`.
5. Actualizar `lastContactedAt`, `nextFollowUpAt`, `threadId` cuando aplique.
6. Avanzar estado según fase.
7. Si el mensaje contiene `cal.com`, marcar `calLinkSent = true`.

### 4.3 Inbound

Responsable de detectar respuestas del host.

Flujo:

1. Polling del inbox cada 15-20 minutos.
2. Tomar mutex Playwright.
3. Identificar threads asociados a leads.
4. Persistir mensajes nuevos como `Message(INBOUND)`.
5. Cambiar lead a `REPLIED_IN_PROGRESS`.
6. Pausar follow-ups automáticos.
7. Invocar Agente de Triaje.
8. Según resultado: cerrar, negociar o pasar a humano.

### 4.4 CRM / Dashboard

Responsable de visibilidad y operación humana.

Debe permitir:

- Ver leads por estado.
- Ver perfil del host y resumen IA.
- Leer timeline `Message`.
- Forzar `HUMAN_TAKEOVER`.
- Enviar mensaje manual.
- Ver métricas de conversión: descubiertos, contactados, respondieron, link enviado, agendaron.

---

## 5. Máquina de estados

Estados definidos:

```text
LEAD_DISCOVERED
INITIAL_MSG_SENT
FOLLOW_UP_1_SENT
FOLLOW_UP_2_SENT
FOLLOW_UP_3_SENT
REPLIED_IN_PROGRESS
HUMAN_TAKEOVER
CLOSED_WON
CLOSED_LOST
```

Transiciones principales:

```text
LEAD_DISCOVERED
  -> INITIAL_MSG_SENT
  -> FOLLOW_UP_1_SENT
  -> FOLLOW_UP_2_SENT
  -> FOLLOW_UP_3_SENT
  -> CLOSED_LOST

Cualquier fase outbound
  -> REPLIED_IN_PROGRESS
  -> CLOSED_LOST | HUMAN_TAKEOVER | CLOSED_WON

REPLIED_IN_PROGRESS
  -> HUMAN_TAKEOVER cuando se activa kill switch o baja confianza
  -> CLOSED_LOST cuando hay rechazo explícito
  -> CLOSED_WON cuando se confirma agenda
```

Reglas:

- Los follow-ups se detienen cuando el host responde.
- `HUMAN_TAKEOVER` pausa la IA.
- `CLOSED_LOST` no se recontacta automáticamente sin política explícita.
- `CLOSED_WON` puede venir de confirmación manual o futuro webhook Cal.com.

---

## 6. Patrón técnico obligatorio para cada agente

Cada agente debe seguir el patrón de capas de la especificación:

```text
Entrada normalizada
  -> Contexto hidratado desde Prisma
  -> Reglas determinísticas / early returns
  -> Briefing del turno
  -> Prefetch de conocimiento
  -> System prompt compilado
  -> LLM
  -> Policy post-LLM
  -> Sanitizer
  -> Persistencia / side effects controlados
```

### 6.1 Hidratar antes de inferir

Antes de invocar Deepseek, construir un contexto con:

- Datos del lead.
- Estado del pipeline.
- Historial de mensajes.
- Campos de control (`calLinkSent`, `botReplyCount`, `nextFollowUpAt`).
- Señales comerciales (`totalProperties`, `businessScale`, `painPoints`).
- Canal actual: Airbnb marketplace.

El LLM no debe buscar ni adivinar estos datos.

### 6.2 Separar verdad, reglas y razonamiento

El prompt debe separar:

- **Verdad:** datos de Prisma y scraping.
- **Reglas:** tono, link, kill switch, límites de canal.
- **Briefing:** lectura del turno actual y directivas.
- **Conocimiento:** módulos de Agent Pilot relevantes para la pregunta.

### 6.3 Determinismo donde importa la confianza

Implementar en código, no solo en prompt:

- No enviar Cal.com en frío.
- Detectar `cal.com` en salida y actualizar `calLinkSent`.
- Cerrar por rechazo explícito.
- Activar `HUMAN_TAKEOVER` por kill switch.
- Sanitizar links con protocolo.
- Evitar choques de Playwright con mutex.

### 6.4 Conocimiento en tres velocidades

- **L0 inline:** datos exactos del lead y reglas comerciales.
- **L1 prefetch:** módulos de Agent Pilot relevantes por keywords: limpieza, huéspedes, gastos, BI, integraciones, operación.
- **L2 RAG:** futuro buscador semántico para preguntas abiertas o técnicas.

Para MVP, L0 + L1 pueden ser suficientes si la base de conocimiento comercial es pequeña y versionada en código.

### 6.5 Salida no confiable hasta policy + sanitizer

Antes de enviar por Airbnb:

- Recortar respuestas largas.
- Eliminar markdown si el canal no lo tolera.
- Eliminar `https://` de links Cal.com.
- Bloquear frases internas como "según mi prompt", "herramienta", "lead status", IDs o UUIDs.
- Validar máximo una pregunta.
- Validar que no haya promesas no soportadas.

---

## 7. Contratos sugeridos

### 7.1 Contexto del lead

```ts
type LeadAgentContext = {
  lead: {
    id: string
    hostAirbnbId: string
    name: string
    hostProfileUrl: string
    primaryListingUrl: string
    primaryListingName?: string | null
    totalProperties: number
    companyName?: string | null
    status: LeadStatus
    businessScale?: string | null
    painPoints?: string | null
    executiveSummary?: string | null
    threadId?: string | null
    botReplyCount: number
    calLinkSent: boolean
    lastContactedAt?: Date | null
    nextFollowUpAt?: Date | null
  }
  recentMessages: Array<{
    direction: 'INBOUND' | 'OUTBOUND' | 'SYSTEM'
    content: string
    aiIntent?: string | null
    sentAt: Date
  }>
  channel: {
    name: 'airbnb'
    locale: 'es-CO'
    constraints: string[]
  }
}
```

### 7.2 Resultado del Perfilador

```ts
type ProfilerResult = {
  businessScale: string | null
  painPoints: string | null
  executiveSummary: string | null
  confidence: 'high' | 'medium' | 'low'
  evidence: string[]
}
```

### 7.3 Resultado del Negociador

```ts
type NegotiatorResult = {
  message: string
  includesCalLink: boolean
  shouldHumanTakeover: boolean
  shouldCloseLost: boolean
  aiIntent: string
}
```

---

## 8. Prompts base por agente

### 8.1 Perfilador

```text
Eres el Agente Perfilador interno de Agent Pilot.

Tu trabajo es leer datos publicos de un anfitrion de Airbnb y producir contexto comercial para prospeccion B2B.

No escribes al host. No vendes. No avanzas estados. Solo enriqueces el CRM.

Usa como verdad los datos extraidos. Si una conclusion es inferida, dilo como hipotesis. Si no hay evidencia, devuelve null.

Salida obligatoria:
- businessScale
- painPoints
- executiveSummary
- confidence
- evidence
```

### 8.2 Triaje

```text
Eres el Agente de Triaje interno de Agent Pilot.

Tu trabajo es clasificar la ultima respuesta del host para decidir el siguiente paso del pipeline.

No redactes el mensaje final. No incluyas Cal.com. Solo clasifica.

Clases:
- INTERESADO
- DUDA_TECNICA
- RECHAZO
- AMBIGUO

Si hay rechazo explicito, recomienda CLOSED_LOST.
Si hay interes o duda tecnica, recomienda invocar al Negociador.
Si la confianza es baja y el lead ya recibio Cal.com, recomienda HUMAN_TAKEOVER.
```

### 8.3 Negociador

```text
Eres el Agente Negociador de Agent Pilot.

Objetivo unico: mover al host hacia una llamada corta de diagnostico.

Reglas duras:
1. No des explicaciones largas.
2. Responde la duda en una sola idea concreta.
3. Si ya estamos en el momento debido, invita a agendar con cal.com/agent-pilot.
4. Nunca uses https:// en el link.
5. Maximo una pregunta o llamada a la accion.
6. No prometas integraciones, precios o resultados que no esten en la base de conocimiento.
7. Si el lead ya supero el limite de respuestas del bot tras enviar el link, no respondas: pide HUMAN_TAKEOVER.
```

---

## 9. Orden recomendado de implementación

### Fase A — Visibilidad operativa

- API `GET /api/leads`.
- API `GET /api/leads/[id]`.
- Dashboard de leads.
- Timeline de mensajes.

Motivo: antes de automatizar conversaciones, el equipo necesita ver y auditar lo que ya existe en Neon.

### Fase B — Outbound Fase 1

- Worker que toma leads `LEAD_DISCOVERED`.
- Primer mensaje frío sin link.
- Captura de `threadId`.
- Persistencia de `Message(OUTBOUND)`.
- Estado `INITIAL_MSG_SENT`.

### Fase C — Inbound polling

- Polling inbox.
- Persistencia `Message(INBOUND)`.
- Estado `REPLIED_IN_PROGRESS`.
- Pausa de follow-ups.

### Fase D — Triaje + Negociador

- Clasificación de respuestas.
- Generación de respuesta corta.
- Envío de Cal.com solo en momento debido.
- `calLinkSent` y `botReplyCount`.
- Kill switch.

### Fase E — Follow-ups + QStash

- Fases 2, 3 y 4.
- Cálculo de `nextFollowUpAt`.
- Break-up con link.
- Cierre `CLOSED_LOST`.

### Fase F — Concurrencia y alertas

- Mutex `SystemState`.
- Reintentos/backoff.
- Alertas `HUMAN_TAKEOVER`.
- Logs estructurados.

### Fase G — Perfilador

- Enriquecimiento con IA durante harvest.
- Dashboard con `businessScale`, `painPoints`, `executiveSummary`.
- Filtros por calidad de lead.

---

## 10. Testing mínimo

### Unit tests

- Triaje: interés, duda técnica, rechazo, ambiguo.
- Policy: remover `https://`, máximo una pregunta, bloquear Cal.com en frío.
- Sanitizer: IDs internos, nombres de herramientas, estados CRM.
- Briefing: detecta si ya se envió link y si aplica kill switch.

### Integration tests

- Lead descubierto -> primer mensaje -> `INITIAL_MSG_SENT`.
- Inbound detectado -> `REPLIED_IN_PROGRESS` -> triaje.
- Interés -> negociador -> mensaje con Cal.com -> `calLinkSent = true`.
- Rechazo -> `CLOSED_LOST`.
- Tercera respuesta tras link -> `HUMAN_TAKEOVER`.

### E2E / smoke

- `npm run db:smoke`.
- Harvest controlado sobre un mercado pequeño.
- Envío Playwright con cuenta de prueba o sandbox.
- Validación manual en dashboard.

---

## 11. Métricas y alertas

Métricas principales:

- Leads descubiertos por día.
- Leads contactados.
- Respuestas recibidas.
- Tasa de respuesta por fase.
- Leads con `calLinkSent = true`.
- Conversión a `CLOSED_WON`.
- Leads en `HUMAN_TAKEOVER`.
- Errores Playwright.
- Sesión Airbnb expirada.
- Tiempo promedio entre descubrimiento y primer contacto.

Alertas mínimas:

- `HUMAN_TAKEOVER`.
- CAPTCHA o bloqueo de Airbnb.
- Fallo de login/sesión expirada.
- Mutex Playwright bloqueado demasiado tiempo.
- Error del agente o salida bloqueada por policy.

---

## 12. Decisiones de diseño

1. **CRM como fuente de verdad:** ningún agente decide estado solo en memoria.
2. **Prospectar hosts, no propiedades:** `hostAirbnbId` es la clave de deduplicación.
3. **Airbnb sin webhooks:** inbound se resuelve por polling.
4. **Playwright serializado:** inbound y outbound no compiten por navegador.
5. **Cal.com protegido:** el link es una herramienta de conversión, no parte del primer contacto.
6. **LLM con salida gobernada:** policy + sanitizer son obligatorios antes de enviar.
7. **Humano como cierre de seguridad:** si el bot ya generó interés pero la conversación se alarga, entra ventas manual.

---

## 13. Checklist de listo para construir

- [ ] Existe cliente LLM para Deepseek.
- [ ] Existe módulo de prompts versionado por agente.
- [ ] Existe compilador de contexto `LeadAgentContext`.
- [ ] Existe policy/sanitizer compartido.
- [ ] Existe detector `includesCalLink`.
- [ ] Existe mutex `SystemState`.
- [ ] Existe persistencia de `Message`.
- [ ] Existe worker outbound.
- [ ] Existe worker inbound.
- [ ] Existe dashboard/API para auditoría.
- [ ] Existen tests unitarios de reglas críticas.

---

## 14. Primer corte recomendado

El primer MVP no debe intentar construir todo el enjambre a la vez.

El corte más seguro es:

1. Dashboard/API para ver leads existentes.
2. Outbound Fase 1 sin IA generativa compleja: plantilla parametrizada con datos del lead.
3. Inbound polling y persistencia de respuestas.
4. Triaje + Negociador solo para respuestas reales.
5. Policy estricta para Cal.com, kill switch y sanitización.

Con esto el sistema ya puede probar la hipótesis comercial principal: si anfitriones con varias propiedades responden cuando el mensaje se personaliza por volumen y si aceptan una llamada cuando el link aparece en el momento debido.
