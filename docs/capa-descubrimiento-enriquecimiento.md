# Capa de descubrimiento y enriquecimiento

Documentación de la capa 2.1: harvest de hosts Airbnb, persistencia en Neon y enriquecimiento con el Agente Perfilador (Deepseek).

## Qué hace

1. **Harvest** — Playwright busca listings, extrae perfil del host, valida `totalProperties`, deduplica por `hostAirbnbId` y persiste leads en `LEAD_DISCOVERED` con contexto `HARVEST_CONTEXT:`.
2. **Enrich** — El Perfilador genera `businessScale`, `painPoints` y `executiveSummary` desde el contexto scrapeado.
3. **Prod** — Vercel recibe el cron (`POST /api/cron/harvest`) y reenvía al container worker vía `HARVEST_WORKER_URL`.

## Archivos principales

| Ruta | Rol |
|---|---|
| `apps/scraper/scripts/harvest-run.ts` | Worker CLI + `runHarvest()` |
| `apps/scraper/scripts/enrich-leads.ts` | Worker batch + `runEnrichment()` |
| `apps/scraper/src/discovery/harvester.ts` | Orquestación por listing |
| `apps/scraper/src/enrichment/enrich-lead.ts` | Lógica compartida del Perfilador |
| `apps/scraper/src/server/worker-http.ts` | Servidor HTTP del container |
| `apps/scraper/src/scraping/airbnb-host.ts` | Heurística `totalProperties` con confianza |
| `apps/scraper/src/resilience/retry.ts` | Reintentos con backoff |
| `apps/scraper/src/scraping/blockers.ts` | Detección CAPTCHA / red / sesión |
| `apps/web/app/api/cron/harvest/route.ts` | Cron HTTP en Vercel |
| `packages/ai/src/agents/profiler.ts` | Agente Perfilador |

## Endpoints HTTP

### Vercel

- `POST /api/cron/harvest` — auth `CRON_SECRET` o firma QStash; forward a `HARVEST_WORKER_URL`.

### Container worker (`npm run worker:serve`)

- `POST /run/harvest` — ejecuta harvest completo.
- `POST /run/enrich` — ejecuta batch de enriquecimiento.

Auth en worker: header `Authorization: Bearer ${CRON_SECRET}`.

Respuestas:

- `200` — job completado (body incluye `summary`).
- `401` — token inválido.
- `409` — mutex Playwright ocupado (QStash puede reintentar).
- `503` — sesión Airbnb expirada, auth faltante o búsqueda bloqueada.

## Variables de entorno

| Variable | Default | Uso |
|---|---|---|
| `HARVEST_WORKER_URL` | — | URL del worker (`…/run/harvest`) para cron Vercel |
| `WORKER_PORT` | `8080` | Puerto del servidor HTTP en container |
| `HARVEST_ENRICH_SYNC` | `false` | Invocar Perfilador al final de cada lead creado/actualizado |
| `HARVEST_MUTEX_RETRIES` | `3` | Reintentos si mutex ocupado |
| `HARVEST_MUTEX_RETRY_DELAY_MS` | `30000` | Pausa entre reintentos de mutex |
| `HARVEST_LISTING_RETRIES` | `3` | Reintentos de navegación por listing |
| `HARVEST_LISTING_RETRY_DELAY_MS` | `2000` | Backoff base entre reintentos de listing |
| `ENRICH_BATCH_SIZE` | `10` | Leads por corrida de `enrich:run` |
| `DEEPSEEK_API_KEY` | — | Requerido para enrich sync o async |

Ver también `HARVEST_*` e `ICP_INCLUDE_OPTIONAL_MARKETS` en `.env.example`. El ICP (10–25 props, superhost) vive en `apps/scraper/src/discovery/icp.ts`, no en env.

## Flujo prod (QStash)

Schedule recomendado: **cada 4 horas** → `POST https://<vercel-app>/api/cron/harvest`.

Vercel forward → `HARVEST_WORKER_URL` (ej. `https://worker.example.com/run/harvest`).

## Cómo probar en local

```bash
# Sesión Airbnb
npm run auth:login

# Harvest directo
npm run harvest:run

# Enrich async
npm run enrich:run

# Harvest con Perfilador síncrono
HARVEST_ENRICH_SYNC=true npm run harvest:run

# Worker HTTP
npm run worker:serve

# Simular cron (otra terminal, con web en :3000)
curl -X POST http://localhost:3000/api/cron/harvest \
  -H "Authorization: Bearer $CRON_SECRET"
```

Tests unitarios: `npm run test:unit`.

Reportes JSON del harvest: `apps/scraper/reports/harvest-*.json`.

## Skip reasons en harvest

| Reason | Significado |
|---|---|
| `below_min` | Menos de 10 propiedades (`ICP.MIN_PROPERTIES`) |
| `above_max` | Más de 25 propiedades (`ICP.MAX_PROPERTIES`) |
| `not_superhost` | Host sin badge superhost |
| `hotel_loft` | Keyword excluido en listing, company o bio |
| `wrong_market` | Mercado fuera de Bogotá/Medellín (u opt-in) |
| `properties_count_uncertain` | No se pudo verificar conteo de propiedades |
| `page_blocked` | CAPTCHA o bloqueo en el listing |
| `duplicate_in_run` | Mismo host ya procesado en la corrida |
