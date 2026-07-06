# Composio SDK — Acceso a correos (Gmail)

Referencia de documentación para acceder, leer y buscar correos de una cuenta usando el Composio SDK.

> Versión del toolkit Gmail referenciada: `20260506_01`. Verifica siempre la versión vigente en el dashboard, ya que las versiones cambian.

---

## 1. Enlaces clave de documentación

| Tema | URL |
|------|-----|
| Toolkit Gmail (catálogo de tools) | https://docs.composio.dev/toolkits/gmail |
| Ejecutar tools (Executing Tools) | https://docs.composio.dev/docs/executing-tools |
| Obtener tools y esquemas | https://docs.composio.dev/docs/fetching-tools |
| CLI de Composio | https://docs.composio.dev/docs/cli |
| Repositorio oficial (SDKs Python/TS) | https://github.com/composiohq/composio |
| Documentación general | https://docs.composio.dev/docs |

---

## 2. Instalación del SDK

**TypeScript / JavaScript**
```bash
npm install @composio/core
# o: yarn add @composio/core / pnpm add @composio/core
```

**Python** (requiere Python 3.10+)
```bash
pip install composio
```

---

## 3. Conceptos importantes

- **Tool**: cada tool es una acción de API individual, descrita con su esquema, parámetros y tipo de retorno.
- **Toolkit**: los tools viven dentro de toolkits como Gmail, Slack o GitHub. Composio gestiona la autenticación.
- **User scoping**: todas las tools están vinculadas a un usuario específico, por eso cada ejecución incluye un `user_id`. Cada usuario debe autenticarse con su servicio (Gmail) mediante OAuth2 antes de ejecutar tools.
- **Autenticación**: Gmail usa OAuth2 (hay opción de "Composio Managed App" para no configurar credenciales propias).

---

## 4. Tools de Gmail para acceder a correos

Tools más relevantes para **lectura / acceso** de correos (el toolkit completo tiene 63 tools):

| Slug | Descripción |
|------|-------------|
| `GMAIL_FETCH_EMAILS` | Obtiene una lista de mensajes, con filtrado, paginación y recuperación opcional del contenido completo. |
| `GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID` | Obtiene un mensaje específico por su `message_id`. |
| `GMAIL_FETCH_MESSAGE_BY_THREAD_ID` | Recupera los mensajes de un hilo por su `thread_id`. |
| `GMAIL_LIST_THREADS` | Lista hilos de la cuenta, con filtrado y paginación. |
| `GMAIL_LIST_LABELS` | Lista las etiquetas del sistema y de usuario. |
| `GMAIL_GET_PROFILE` | Recupera info del perfil (dirección, totales de mensajes/hilos, historyId). |
| `GMAIL_GET_ATTACHMENT` | Recupera un adjunto específico de un mensaje. |
| `GMAIL_GET_CONTACTS` | Obtiene los contactos de la cuenta autenticada. |

Para enviar/redactar: `GMAIL_SEND_EMAIL`, `GMAIL_CREATE_EMAIL_DRAFT`, `GMAIL_REPLY_TO_THREAD`, etc.

---

## 5. Ejecutar una tool — `GMAIL_FETCH_EMAILS`

### Python
```python
from composio import Composio

user_id = "user-k7334"  # identificador de tu usuario autenticado

composio = Composio(api_key="your_composio_key")

result = composio.tools.execute(
    "GMAIL_FETCH_EMAILS",
    user_id=user_id,
    arguments={
        "query": "is:unread newer_than:1d",
        "max_results": 10,
    },
)

print(result)
```

### TypeScript
```typescript
import { Composio } from "@composio/core";

const userId = "user-k7334";

const composio = new Composio({ apiKey: "your_composio_key" });

const result = await composio.tools.execute("GMAIL_FETCH_EMAILS", {
  userId,
  arguments: {
    query: "is:unread newer_than:1d",
    max_results: 10,
  },
});

console.log(result);
```

> El parámetro `query` usa la misma sintaxis de búsqueda de Gmail (`from:`, `subject:`, `is:unread`, `newer_than:1d`, etc.). Consulta los argumentos exactos de cada tool en el dashboard de Composio.

---

## 6. Fijar versión del toolkit (opcional)

Puedes anclar la versión del toolkit a nivel del SDK para reproducibilidad:

**Python**
```python
composio = Composio(
    api_key="your_composio_key",
    toolkit_versions={"gmail": "20260506_01"},
)
```

**TypeScript**
```typescript
const composio = new Composio({
  apiKey: "your_composio_key",
  toolkitVersions: { gmail: "20260506_01" },
});
```

---

## 7. Vía CLI (alternativa)

```bash
# Buscar la tool adecuada
composio search "summarize my unread gmail"

# Ver el esquema de entrada requerido
composio execute GMAIL_FETCH_EMAILS --get-schema

# Conectar la cuenta de Gmail (OAuth)
composio link gmail

# Ejecutar la tool
composio execute GMAIL_FETCH_EMAILS \
  -d '{ query: "is:unread newer_than:1d", max_results: 10 }'
```

Para generar tipos locales (TS/Python) a partir de los esquemas:
```bash
composio generate ts --toolkits gmail
composio generate py --toolkits gmail
```

---

## 8. Tipos / esquemas

- Genera código con tipado seguro para ejecución directa con `composio generate` (crea tipos TS o Python desde los esquemas de las tools).
- Inspecciona parámetros y esquemas de cada tool visualmente en el dashboard de Composio.
- Doc: https://docs.composio.dev/docs/fetching-tools

---

## 9. 2FA Airbnb (integración en este proyecto)

Cuando Airbnb pide verificación en dos pasos, el login de Playwright obtiene el código OTP desde Gmail vía Composio **por cuenta de prospección**.

### Multi-cuenta (Fase D)

Cada `ProspectAccount` conecta su propio Gmail desde **`/settings/accounts` → Conectar Gmail**. Tras OAuth:

| Campo DB | Valor |
|----------|-------|
| `composioUserId` | `prospect-{prospectAccount.id}` |
| `composioConnectionId` | ID de connected account en Composio |
| `composioConnectedAt` | Timestamp de conexión |

El scraper lee OTP con `buildOtpConfigFromAccount()` — ya no requiere `COMPOSIO_USER_ID` / `COMPOSIO_CONNECTION_ID` por cuenta.

### Variables `.env` (proyecto, no por usuario)

```env
COMPOSIO_API_KEY=your-composio-api-key
COMPOSIO_GMAIL_AUTH_CONFIG_ID=your-gmail-auth-config-id
APP_URL=http://localhost:3000
```

`COMPOSIO_GMAIL_AUTH_CONFIG_ID` se crea **una vez** en el dashboard Composio (Gmail toolkit, Composio Managed Auth).

**Deprecated** (solo legacy / una cuenta):

```env
# COMPOSIO_USER_ID=...
# COMPOSIO_CONNECTION_ID=...
```

Si `COMPOSIO_CONNECTION_ID` está mal o expiró, el helper reintenta resolviendo la cuenta Gmail por `userId`.

Versión del toolkit Gmail (requerida por el SDK):

```env
COMPOSIO_GMAIL_TOOLKIT_VERSION=20260506_01
```

Opcionales:

```env
COMPOSIO_2FA_TIMEOUT_MS=90000
COMPOSIO_2FA_POLL_MS=5000
```

### Query Gmail usada

```
from:automated@airbnb.com subject:(código OR code) newer_than:1d
```

El helper ordena mensajes por `internalDate` y extrae el código de 6 dígitos del cuerpo (asunto tipo *"Aquí tienes tu código de Airbnb"*).

### Comandos

```bash
# Probar Composio + Gmail para una cuenta concreta (desde DB)
npm run auth:otp-test -- --account-id <prospect-account-uuid>

# Legacy: una sola cuenta vía .env (deprecated)
npm run auth:otp-test

# Login completo con 2FA automático y guardado de sesión
npm run auth:login

# Verificar que la sesión guardada funciona
npm run auth:verify
```

La sesión se guarda en `playwright/.auth/airbnb-session.json` (gitignored).

### Seguridad

- No commitear `.env`, API keys ni archivos de sesión.
- No loguear OTPs en producción; `auth:otp-test` es solo para depuración local.

### Archivos relevantes

| Archivo | Rol |
|---------|-----|
| `packages/composio/` | SDK compartido: connect OAuth, `buildOtpConfigFromAccount` |
| `apps/scraper/src/composio/gmail-otp.ts` | Fetch Gmail + polling OTP |
| `tests/helpers/composio-gmail.ts` | Re-export para tests Playwright |
| `tests/helpers/airbnb-2fa.ts` | Modal 2FA en Playwright |
| `tests/helpers/airbnb-auth.ts` | Flujo de login integrado (pasa `composioUserId` por cuenta) |
| `scripts/test-composio-otp.ts` | Script de depuración (`--account-id`) |
| `apps/web/app/api/accounts/.../composio/` | OAuth connect + callback |

---

*Documento de referencia generado a partir de la documentación pública de Composio (docs.composio.dev). Las versiones de toolkit, slugs y argumentos pueden cambiar; verifica siempre contra la documentación oficial vigente.*