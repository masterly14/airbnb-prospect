# Agent Pilot — test-airbnb

Monorepo de prospección Airbnb: scraper Playwright, CRM Neon y dashboard Next.js.

## Comandos

```bash
# Web
npm run dev

# Workers Playwright (requieren auth:login + DATABASE_URL)
npm run harvest:run
npm run enrich:run
npm run outbound:run
npm run inbound:run

# Worker HTTP para prod (container)
npm run worker:serve

# Auth Airbnb
npm run auth:login
npm run auth:verify

# Tests
npm run test:unit
npm run test:harvest

# DB
npm run db:migrate
npm run db:studio
```

## Cron en producción

| Job | Ruta Vercel | Worker URL |
|---|---|---|
| Harvest | `POST /api/cron/harvest` | `HARVEST_WORKER_URL` → `/run/harvest` |
| Outbound | `POST /api/cron/outbound` | `OUTBOUND_WORKER_URL` |
| Inbound | `POST /api/cron/inbound` | `INBOUND_WORKER_URL` |

Variables: `CRON_SECRET`, `QSTASH_*`, `CALCOM_WEBHOOK_SECRET`, ver `.env.example`.

## Webhook Cal.com

| Evento | Ruta Vercel |
|---|---|
| `BOOKING_CREATED` | `POST /api/webhooks/calcom` |

Documentación: [`docs/cal-com-webhook.md`](docs/cal-com-webhook.md).

Documentación detallada de la capa de descubrimiento: [`docs/capa-descubrimiento-enriquecimiento.md`](docs/capa-descubrimiento-enriquecimiento.md).

Estado del proyecto: [`docs/ESTADO-PROYECTO.md`](docs/ESTADO-PROYECTO.md).
