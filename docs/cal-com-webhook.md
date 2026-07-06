# Integración webhook Cal.com

Detecta agendamientos en Cal.com y cierra leads automáticamente como `CLOSED_WON` en Neon.

## Flujo

1. Outbound Fase 4 (o futuro Negociador) envía link con `?metadata[leadId]=<uuid>`.
2. El host agenda en Cal.com.
3. Cal.com dispara `BOOKING_CREATED` a `POST /api/webhooks/calcom`.
4. Vercel verifica firma HMAC, persiste `CalBooking` y actualiza el lead.

## Archivos principales

| Ruta | Rol |
|---|---|
| `apps/scraper/src/messaging/cal-link.ts` | `buildCalComLinkForLead(leadId)` |
| `apps/web/lib/calcom/verify-signature.ts` | Verificación `X-Cal-Signature-256` |
| `apps/web/lib/calcom/parse-payload.ts` | Parseo del body webhook |
| `apps/web/lib/calcom/apply-booking-created.ts` | Transacción CRM → `CLOSED_WON` |
| `apps/web/app/api/webhooks/calcom/route.ts` | Endpoint HTTP |
| `packages/db/prisma/schema.prisma` | Modelos `CalBooking`, `Lead.calBookedAt` |

## Variables de entorno

| Variable | Uso |
|---|---|
| `CALCOM_WEBHOOK_SECRET` | Secret configurado en Cal.com → Developer → Webhooks |
| `CAL_COM_LINK` | Base del link (sin `https://`) usado en outbound |
| `DATABASE_URL` | Neon — requerido en Vercel |

## Configuración en Cal.com

1. **Settings → Developer → Webhooks → New webhook**
2. **Subscriber URL:** `https://<tu-app>.vercel.app/api/webhooks/calcom`
3. **Trigger:** `BOOKING_CREATED`
4. **Secret:** mismo valor que `CALCOM_WEBHOOK_SECRET` en Vercel

## Endpoint

`POST /api/webhooks/calcom`

- Header requerido: `X-Cal-Signature-256` (HMAC-SHA256 del body crudo)
- `401` — firma inválida
- `400` — JSON inválido
- `200` — procesado, ignorado o lead no encontrado (Cal.com no reintenta en 200)

Respuesta exitosa de procesamiento:

```json
{
  "ok": true,
  "processed": true,
  "duplicate": false,
  "leadId": "...",
  "calUid": "..."
}
```

## Prueba local

```bash
npm run dev

# En otra terminal
ngrok http 3000
```

Configura el webhook de Cal.com apuntando a `https://<id>.ngrok.io/api/webhooks/calcom`.

Prueba manual del link:

```
https://cal.com/agent-pilot/diagnostico?metadata[leadId]=<uuid-desde-db-studio>
```

Tras agendar, verifica en Prisma Studio:

- `Lead.status = CLOSED_WON`
- `Lead.calBookedAt` con la fecha de la cita
- Fila en `CalBooking` con `calUid`
- `Message` SYSTEM: `Cal.com: agendado — ...`

## Troubleshooting

| Síntoma | Causa probable |
|---|---|
| 401 Invalid signature | Secret distinto entre Cal.com y `CALCOM_WEBHOOK_SECRET`, o body alterado antes de verificar |
| 200 `processed: false`, `missing_lead_id` | Link sin `metadata[leadId]` — revisar outbound Fase 4 |
| 200 `processed: false`, `lead_not_found` | UUID inválido o lead borrado |
| Lead no cambia | Webhook apunta a URL incorrecta o evento distinto a `BOOKING_CREATED` |

## Alcance MVP

- Solo `BOOKING_CREATED`
- No maneja cancelaciones ni reprogramaciones
- No hace match por email/nombre del attendee
