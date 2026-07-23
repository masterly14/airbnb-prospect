# Estado del Proyecto — Agent Pilot (Prospección Airbnb)

Documento de referencia sobre lo construido hasta la fecha y lo pendiente según la especificación en [`apps/web/docs/system.md`](apps/web/docs/system.md).

---

## 1. Lo construido actualmente

### 1.1 Monorepo y datos (fuente de verdad)

| Componente | Ubicación | Estado |
|---|---|---|
| npm workspaces | Raíz (`apps/*`, `packages/*`) | Operativo |
| Paquete Prisma compartido | `packages/db` (`@repo/db`) | Operativo |
| Schema CRM | `Lead`, `Message`, `SystemState` | Modelado y migrado en Neon |
| Campos ICP en `Lead` | `isSuperhost`, `market`, `icpSkipReason` | ✅ Migración `20260704180000_add_lead_icp_fields` |
| Campo `calLinkSent` | Modelo `Lead` | Usado en outbound (Fase 4 y detección `cal.com`) |
| Estados del pipeline | `LeadStatus` (9 estados) | Definidos en DB y usados en runtime |
| `.env` unificado | Raíz del repo | Credenciales + tuning operativo (ver §1.7) |
| `.env.example` | Raíz | Plantilla documentada de todas las variables |

**Scripts disponibles desde la raíz:** `dev`, `build`, `db:migrate`, `db:studio`, `db:smoke`, `harvest:run`, `enrich:run`, `worker:serve`, `outbound:run`, `inbound:run`, `test:harvest`, `test:outbound`, `test:inbound`, `test:unit`, `auth:login`, etc.

### 1.2 Paquetes compartidos nuevos

| Paquete | Ubicación | Estado |
|---|---|---|
| `@repo/ai` | `packages/ai` | Cliente Deepseek + Agente Perfilador (`runProfiler`) |
| `@repo/cron-auth` | `packages/cron-auth` | Verificación `CRON_SECRET` + firma Upstash QStash |

### 1.3 Scraper / Playwright (`apps/scraper`)

Código de producción movido a `apps/scraper/src/` (discovery, scraping, persistence, messaging, logging). Tests E2E en `tests/`; helpers legacy en `tests/helpers/` aún referenciados por algunos specs.

| Capacidad | Detalle |
|---|---|
| Autenticación Airbnb | Login con email/contraseña + 2FA vía Composio/Gmail |
| Contexto Colombia | `airbnb.com.co`, locale `es-CO`, timezone Bogotá |
| Validación de sesión | `session-utils.ts` — reutilizado por harvest, outbound e inbound |
| Búsqueda con fechas | Medellín u otras ciudades vía UI o URL directa |
| Scraping de resultados | Título, precio, URL y rating de listings |
| Scraping paginado | `HARVEST_MAX_PAGES` + `HARVEST_MAX_LISTINGS` |
| Scraping de detalle / host | API GraphQL + HTML embebido + DOM |
| **Harvester programático** | `scripts/harvest-run.ts` — worker Node con mutex Playwright |
| Multi-mercado | `markets.ts` — default **Bogotá + Medellín**; Cali/Bucaramanga opt-in (`ICP_INCLUDE_OPTIONAL_MARKETS`) |
| Filtro ICP | `icp.ts` — 10–25 props, superhost, hotel/loft, mercado; importado por harvest y outbound |
| Deduplicación | Por `hostAirbnbId` (no por propiedad) |
| Persistencia leads | `lead-repository.ts` — upsert en `LEAD_DISCOVERED` |
| Contexto harvest | `Message(SYSTEM)` con prefijo `HARVEST_CONTEXT:` |
| **Enriquecimiento async** | `scripts/enrich-leads.ts` — Perfilador Deepseek post-harvest |
| **Outbound Fases 1–4** | Plantillas parametrizadas (sin LLM), sin `cal.com` en 1–3 |
| Envío anti-bot | `airbnb-messaging.ts` — `pressSequentially` con `delay: 45` |
| Pipeline outbound | Estados, `nextFollowUpAt`, `lastContactedAt`, `threadId`, `calLinkSent` |
| **Inbound polling** | `airbnb-inbox.ts` — scrape thread, dedup, clasificación host/self |
| Pipeline inbound | `REPLIED_IN_PROGRESS`, pausa follow-ups (`nextFollowUpAt = null`) |
| Mutex Playwright | `system-state.ts` — `IS_PLAYWRIGHT_RUNNING` |
| Cuentas prospección | `ProspectAccount`, `AccountBlockEvent` — cooldown 5 h, alerta Resend |
| Bloqueos outbound | `account-repository.ts` — `handleAccountBlock`, `classifyBlockType` |
| Logging estructurado | `harvest-logger`, `outbound-logger`, `inbound-logger` |
| Reportes JSON | Salida en `apps/scraper/reports/` tras cada run |

**Archivos clave:**

- Discovery: `src/discovery/icp.ts`, `harvester.ts`, `markets.ts`
- Scraping: `src/scraping/airbnb-scraper.ts`, `airbnb-host.ts`, `airbnb-search.ts`, `airbnb-context.ts`
- Persistence: `src/persistence/lead-repository.ts`, `outbound-pipeline.ts`, `inbound-pipeline.ts`, `system-state.ts`
- Accounts: `src/accounts/account-repository.ts`
- Messaging: `src/messaging/outbound-templates.ts`, `airbnb-messaging.ts`, `airbnb-inbox.ts`
- Notifications: `src/notifications/resend.ts`, `notify.ts`
- Workers: `scripts/harvest-run.ts`, `enrich-leads.ts`, `outbound-run.ts`, `inbound-run.ts`
- Tests unitarios: `*.test.ts` en `src/`; E2E: `tests/harvest-leads.spec.ts`, `outbound-send.spec.ts`, `inbound-poll.spec.ts`

### 1.4 Web / Dashboard (`apps/web`)

| Capacidad | Detalle |
|---|---|
| Next.js 16 + App Router | Scaffold con shadcn/ui |
| Integración `@repo/db` | `transpilePackages` + `lib/db.ts` |
| UI Pipeline (scaffold) | Kanban, filtros, detalle de lead — **datos mock** (`MockLeadRepository`) |
| Cron HTTP outbound | `POST /api/cron/outbound` — auth + forward a `OUTBOUND_WORKER_URL` |
| Cron HTTP inbound | `POST /api/cron/inbound` — auth + forward a `INBOUND_WORKER_URL` |
| API REST de leads | No implementada (dashboard no lee Neon) |

### 1.5 Infraestructura auxiliar

- **Dockerfile** adaptado al monorepo (scraper + `@repo/db`).
- **`.gitignore`** actualizado (sin SQLite legado).
- **Documentación de sistema** en `apps/web/docs/system.md`.
- **HAR de referencia** en `docs-har/` (análisis de red Airbnb).

### 1.6 Capacidad operativa 24/7 (diseño acordado)

Valores aterrizados en `.env` para equilibrar prospección y anti-bot (ver `system.md` §3 y §7). **El código no fija frecuencias de cron** — QStash las define en producción.

| Variable / parámetro | Valor operativo | Motivo |
|---|---|---|
| `HARVEST_MAX_LISTINGS` | 15 | ~2–3 min de sesión; >25 eleva riesgo de CAPTCHA |
| `HARVEST_MAX_PAGES` | 3 | ~18 cards/página en Airbnb |
| ~~`HARVEST_MIN_PROPERTIES`~~ | — | **Deprecado** — ICP en `apps/scraper/src/discovery/icp.ts` (10–25) |
| `ICP_INCLUDE_OPTIONAL_MARKETS` | `false` | `true` abre Cali + Bucaramanga en harvest default |
| `HARVEST_MARKETS` | Bogotá, Medellín (default) | Cartagena solo si se lista explícitamente |
| `HARVEST_ROTATE_MARKETS` | `true` | Un mercado por ejecución vía `SystemState` |
| `OUTBOUND_BATCH_SIZE` | 5 | Sesión corta (~5–7 min con 5 leads) |
| `OUTBOUND_LEAD_DELAY_MS` | 8000 | ~21 s entre mensajes (tipeo + pausa humana) |
| `OUTBOUND_FU1/FU2/FU3_DELAY_DAYS` | 3 / 5 / 7 | Ciclo completo ~15 días, 4 toques |
| `OUTBOUND_REQUIRE_ENRICHMENT` | `false` | Fase 1 solo necesita `totalProperties` del harvest |
| `INBOUND_BATCH_SIZE` | 10 | ~30 s de sesión por poll |
| `INBOUND_THREAD_DELAY_MS` | 3000 | Pausa entre threads del inbox |
| `INBOUND_MAX_MESSAGES_PER_THREAD` | 20 | Solo mensajes recientes, no hilos históricos largos |

**Cronograma QStash recomendado (24/7):**

| Job | Frecuencia | Runs/día |
|---|---|---|
| Inbound (poll inbox) | cada 18 min | ~80 |
| Outbound (envío) | cada 2 h | 12 |
| Harvest (descubrimiento) | cada 4 h | 6 |

**Throughput semanal estimado** (con ese cron y los batches anteriores):

| Métrica | Semanal (aprox.) |
|---|---|
| Hosts nuevos descubiertos (harvest) | ~250–350 |
| **Primer mensaje en frío (Fase 1)** | **~280–350** |
| Mensajes outbound totales (Fases 1–4) | ~450–550 |
| Polls inbound (lectura, no contacto) | ~560 |

Pendiente: **despliegue QStash harvest en prod** (código listo: `POST /api/cron/harvest` + `HARVEST_WORKER_URL`).

### 1.7 Variables de entorno por capa

Referencia completa en `.env.example`. Resumen:

| Grupo | Variables | Quién las usa |
|---|---|---|
| Auth Airbnb | `AIRBNB_EMAIL`, `AIRBNB_PASSWORD` | `auth:login`, workers Playwright |
| DB | `DATABASE_URL` | Prisma / todos los workers |
| Región | `AIRBNB_BASE_URL`, `LOCALE`, `TIMEZONE`, `BROWSER` | Contexto Playwright |
| Composio 2FA | `COMPOSIO_*` | Login con OTP Gmail |
| Deepseek | `DEEPSEEK_API_KEY`, `MODEL`, `BASE_URL` | `enrich:run`, `@repo/ai` |
| Harvest | `HARVEST_*` | `harvest-run`, harvester, lead-repository |
| Enrich | `ENRICH_BATCH_SIZE` | `enrich-leads.ts` |
| Outbound | `OUTBOUND_*`, `CAL_COM_LINK` | `outbound-run`, templates, pipeline |
| Inbound | `INBOUND_*` | `inbound-run`, inbox scraper |
| Cron / prod | `CRON_SECRET`, `QSTASH_*`, `*_WORKER_URL`, `WORKER_PORT`, `HARVEST_ENRICH_SYNC` | `@repo/cron-auth`, cron routes en web, worker HTTP |

Variables documentadas en `.env.example` pero **no cableadas en código**: `INBOUND_POLL_INTERVAL` (frecuencia = QStash), `OUTBOUND_SENDER_NAME`.

---

## 2. Lo que falta por construir (por capas)

Referencia: [`apps/web/docs/system.md`](apps/web/docs/system.md).

### 2.1 Capa de descubrimimiento y enriquecimiento — implementado

| Capacidad | Estado | Ubicación |
|---|---|---|
| Cron HTTP harvest | ✅ | `apps/web/app/api/cron/harvest/route.ts` + `HARVEST_WORKER_URL` |
| Worker HTTP (harvest/enrich) | ✅ | `apps/scraper/src/server/worker-http.ts` — `POST /run/harvest`, `/run/enrich` |
| Perfilador sync opcional | ✅ | `HARVEST_ENRICH_SYNC=true` en harvest; fallback `enrich:run` |
| Validación `totalProperties` | ✅ | Confianza `explicit/inferred/unknown`; skip `properties_count_uncertain` |
| Reintentos / backoff harvest | ✅ | Mutex, listings y detección CAPTCHA/red en `retry.ts` + `blockers.ts` |

Pendiente operativo: schedule QStash harvest cada 4 h en prod + despliegue del container worker.

### 2.2 Capa Outbound — pendiente

| Pendiente | Descripción |
|---|---|
| Despliegue QStash en prod | Schedules en Upstash apuntando a `/api/cron/outbound` |
| Worker URL en prod | Container con Playwright (`OUTBOUND_WORKER_URL`) |
| Renovación de sesión automática | Detectar logout y re-ejecutar `auth:login` o alertar |

Lo ya implementado: worker, plantillas Fases 1–4, pipeline de estados, `calLinkSent`, regla sin link en frío, cron route, tests.

### 2.3 Capa Inbound — pendiente

| Pendiente | Descripción |
|---|---|
| Despliegue QStash en prod | Poll cada 15–20 min → `/api/cron/inbound` |
| **Triaje + Negociador (§2.4)** | Hook `TODO 2.4` en `airbnb-inbox.ts` tras detectar respuesta |
| Worker URL en prod | `INBOUND_WORKER_URL` |

Lo ya implementado: polling, dedup, `Message(INBOUND)`, `REPLIED_IN_PROGRESS`, pausa follow-ups, sync de historial, cron route, tests.

### 2.4 Capa de inteligencia artificial (enjambre de agentes)

| Agente | Estado |
|---|---|
| **Perfilador** | ✅ Operativo vía `enrich:run` + `@repo/ai` — pendiente integración sync en harvest |
| **Triaje** | ❌ Clasificar: `INTERESADO`, `DUDA_TECNICA`, `RECHAZO` |
| **Negociador** | ❌ Respuesta corta + Cal.com en el "Momento Debido" |
| Kill Switch | ❌ Tras link: máx. 2 respuestas IA → tercera respuesta host → `HUMAN_TAKEOVER` |
| Contador `botReplyCount` | ❌ Incrementar y evaluar límite por lead |

### 2.5 Capa de pipeline y reglas de negocio (CRM)

| Pendiente | Descripción |
|---|---|
| Cierre por rechazo automático | Triaje `RECHAZO` → `CLOSED_LOST` |
| Cierre por éxito | ✅ Webhook Cal.com `BOOKING_CREATED` → `CLOSED_WON` ([`docs/cal-com-webhook.md`](cal-com-webhook.md)) |
| `HUMAN_TAKEOVER` operativo | Flujo manual + pausar IA |
| Política de re-contacto | Lead `CLOSED_LOST` que vuelve a escribir |
| Métricas de conversión | Dashboard funnel real (no mock) |

Lo ya implementado: transiciones outbound Fases 1–4, inbound detiene follow-ups, `calLinkSent` en break-up.

### 2.6 Capa de concurrencia e infraestructura de workers

| Pendiente | Descripción |
|---|---|
| Orquestación prod | Vercel (web + cron) + worker/container (Playwright) + Neon + QStash |
| Reintentos globales | Backoff ante mutex ocupado (hoy el run falla/skip si mutex locked) |
| Renovación de sesión | Automatizar o alertar |
| Health checks | DB, sesión Airbnb, cola QStash |

Lo ya implementado: mutex `IS_PLAYWRIGHT_RUNNING`, workers harvest/outbound/inbound separados, cron HTTP outbound/inbound, `@repo/cron-auth`.

### 2.7 Capa API (`apps/web`)

| Endpoint / función | Estado |
|---|---|
| `GET /api/leads` | ❌ Pendiente |
| `GET /api/leads/[id]` | ❌ Pendiente |
| `PATCH /api/leads/[id]` | ❌ Pendiente |
| `POST /api/leads/[id]/messages` | ❌ Pendiente |
| `POST /api/cron/outbound` | ✅ Implementado |
| `POST /api/cron/inbound` | ✅ Implementado |
| `POST /api/cron/harvest` | ✅ Implementado |
| Autenticación API operadores | ❌ Pendiente (solo cron auth hoy) |

### 2.8 Capa UI / Dashboard (`apps/web`)

| Pantalla / componente | Estado |
|---|---|
| Tablero Kanban (scaffold) | ✅ UI con mock data |
| Detalle de lead (scaffold) | ✅ UI con mock data |
| Timeline de mensajes | ✅ UI mock |
| Conexión a Neon / API real | ❌ Pendiente |
| Métricas funnel | ❌ Pendiente |
| Alertas in-app `HUMAN_TAKEOVER` | ❌ Scaffold (`alerts-banner` polling mock) |

### 2.9 Capa de observabilidad y alertas

| Pendiente | Descripción |
|---|---|
| Alertas Slack/Email | ✅ Resend handoff + cooldown | Slack deprecated |
| Logging centralizado | Hoy logs por worker en consola + reportes JSON |
| Health checks | DB, sesión, QStash |
| Reportes unificados | Consolidar `reports/` en dashboard o export |

### 2.10 Integraciones externas

| Integración | Estado | Pendiente |
|---|---|---|
| Neon Postgres | ✅ Conectado | — |
| Composio/Gmail (2FA) | ✅ Operativo | Mantener `COMPOSIO_CONNECTION_ID` vigente |
| Deepseek (LLM) | ✅ Perfilador | Triaje + Negociador |
| Upstash QStash | ⚠️ Código listo (`cron-auth`) | Schedules y keys en prod |
| Cal.com | ✅ Link Fase 4 + webhook → `CLOSED_WON` | Pendiente: cancel/reschedule, alertas |
| Slack / Email | ✅ Resend | Handoff + cooldown; Slack removido de `notify.ts` |

---

## 3. Orden sugerido de implementación (actualizado)

```text
[Fase A] ICP real (10–25, superhost, mercados) → ✅ HECHO (2026-07-04)
[Fase B] Persistencia bloqueos + Resend cooldown   → ✅ HECHO (2026-07-04)
[Fase C] Multi-cuenta + Decodo + rotación       → siguiente
[Fase D] UI onboarding Composio                   → pendiente
[Fase E] Resend handoff                               → ✅ HECHO (2026-07-04); prod 24/7 pendiente
```

---

## 4. Comandos útiles hoy

```bash
# Sesión Airbnb (requerido antes de workers Playwright)
npm run auth:login
npm run auth:verify

# Workers (desde raíz del monorepo)
npm run seed:legacy-account  # Cuenta ProspectAccount legacy (requiere auth + AIRBNB_EMAIL)
npm run harvest:run      # Descubrir hosts → Neon (LEAD_DISCOVERED)
npm run enrich:run       # Perfilador Deepseek (requiere DEEPSEEK_API_KEY)
npm run outbound:run     # Fases 1–4 según estado y nextFollowUpAt
npm run inbound:run      # Poll inbox, detectar respuestas del host

# Tests
npm run test:unit        # Unitarios scraper + ai + cron-auth
npm run test:harvest     # E2E harvest → Neon
npm run test:outbound    # E2E envío outbound (smoke)
npm run test:inbound     # E2E poll inbound (smoke)

# Web + DB
npm run dev              # Next.js dashboard (apps/web)
npm run db:studio        # Inspeccionar leads en Prisma Studio
npm run db:smoke         # Verificar conexión a Neon
```

**Requisitos por comando:**

| Comando | Requiere |
|---|---|
| `harvest:run`, `outbound:run`, `inbound:run` | Sesión válida (`auth:login`), `DATABASE_URL` |
| `enrich:run` | `DEEPSEEK_API_KEY` |
| Cron en Vercel | `CRON_SECRET` o `QSTASH_*`, `*_WORKER_URL` |

---

*Última actualización: 2026-07-04 — Fase A (ICP real) implementada; pipeline harvest/outbound/inbound operativo en local; siguiente: Fase B (bloqueos en DB) y deploy QStash 24/7.*
