# 📄 Especificación del Sistema de Prospección IA para "Agent Pilot" (Enfoque Cal.com)

## 1. Objetivo del Sistema
Automatizar la prospección, cualificación y seguimiento de administradores de rentas cortas en Airbnb. El objetivo único y final de los agentes de IA es generar la curiosidad suficiente para enviar un enlace de agendamiento (**Cal.com**) en el momento estratégico, logrando que el prospecto reserve una llamada de diagnóstico de 15 minutos para activar un piloto.

## 2. Arquitectura General
El ecosistema funciona mediante **Scraping de Estado Constante** (sin Webhooks):

* **Fuente de la Verdad (CRM - Prisma):** Base de datos PostgreSQL que controla los estados.
* **Módulo Inbound (Polling de Node.js):** Revisa cada 15-20 minutos si hay respuestas en el inbox de Airbnb.
* **Módulo Outbound (Upstash Qstash):** Ejecuta los *follow-ups* según los tiempos del CRM.
* **Gestor de Concurrencia (Mutex):** Evita que el Polling y el Cron choquen usando Playwright al mismo tiempo.
* **Cerebro (Multi-Agente IA (Con Deepseek)):** Enjambre de LLMs diseñados exclusivamente para perfilar, manejar objeciones básicas y pivotar hacia la llamada (Cal.com).

## 3. Lógica Comercial: La Estrategia "Francotirador" y la Regla del Link

* **Deduplicación:** Se prospecta al Anfitrión, no a la propiedad (usando el `hostAirbnbId`).
* **Palanca de Venta Principal:** El volumen de su portafolio (`totalProperties`).
* **REGLA DE ORO DEL LINK (Anti-Spam):** Para evitar que Airbnb bloquee tu cuenta, nunca se envía el link de Cal.com en el primer mensaje en frío. El link solo se envía bajo dos condiciones (El "Momento Debido"):
    1. Cuando el *host* responde demostrando el mínimo interés o haciendo una pregunta.
    2. En el último *follow-up* de despedida (*Break-up message*).

## 4. El Enjambre de Inteligencia Artificial (Prompting Orientado a Agendar)
El "Agente Negociador" ya no intenta vender módulos ni explicar cómo funciona la tecnología a profundidad. Su única táctica es dar un "bocado" de información y proponer la llamada.

### A. Agente Perfilador (En el Scraping)
Lee la descripción del *host* y extrae: Número de propiedades y posibles dolores (ej. reseñas de mala limpieza).

### B. Agente de Triaje (Clasificador de Respuestas)
Analiza la respuesta del *host* y define el momento:
* `INTERESADO` (Ej: *"Suena bien, ¿de qué trata?"*). $\rightarrow$ Pasa al Agente Negociador para enviar Link.
* `DUDA_TECNICA` (Ej: *¿Esto se integra con Guesty?"*). $\rightarrow$ Pasa al Agente Negociador para dar respuesta rápida + Link.
* `RECHAZO` (Ej: *"No me interesa"*). $\rightarrow$ Cierra el lead.

### C. Agente Negociador (El "Closer" de Cal.com)
* **[Base de Conocimiento]:** Agent Pilot (Asistente 24/7, Portal Limpiezas, Bodega, Gastos, BI).
* **[Regla Estricta del Prompt]:** *"No des explicaciones largas. Responde a la duda del prospecto en una sola oración atractiva y, de inmediato, invítalo a una llamada de diagnóstico de 10 minutos para mostrarle cómo aplicaría en sus propiedades, adjuntando siempre el link: cal.com/tu-link".*

## 5. El Pipeline de Prospección y Follow-ups (Cron Jobs)

* **Fase 0:** El CRM guarda los datos y la cantidad de propiedades.
* **Fase 1:** * **Objetivo:** Obtener una respuesta, un "Sí" o un "¿De qué hablas?".
    * **Ejemplo IA:** *"Hola [Nombre], vi tu anuncio en [Propiedad]. Noté en tu perfil que administras [X] propiedades. Hemos ayudado a operadores de tu tamaño a poner la atención a huéspedes y limpiezas en piloto automático usando IA (literalmente el equipo gestiona todo desde un chat). ¿Tienes algún cuello de botella operativo actualmente?"*
* **Fase 2:** * **Objetivo:** Insistir desde un ángulo operativo (Limpiezas/Lencería).
    * **Ejemplo IA:** *"Hola [Nombre], imaginé que estarías a tope. Solo te dejo el dato: con tu volumen de [X] propiedades, nuestro portal de limpiezas en cascada te ahorraría horas de coordinación. Si te hace sentido optimizar esto, avísame y te muestro cómo funciona."* (Aún sin link, buscando el *opt-in*).
* **Fase 3:** * **Objetivo:** Apelar a la rentabilidad (Módulo 06 BI).
    * **Ejemplo IA:** *¿Pudiste ver mi mensaje anterior? Además del tiempo, nuestro sistema consolida tus facturas y ocupación para predecir tu demanda. Me encantaría mostrarte el impacto financiero que tendría en tus listados."*
* **Fase 4:** * **Objetivo:** Último intento. Aquí sí se deja caer el link.
    * **Ejemplo IA:** *"Hola [Nombre], imagino que no es el momento o estás 100% enfocado en la operación. Este es mi último mensaje; si en algún momento quieres que hagamos un diagnóstico rápido de tus cuellos de botella y ver cómo Agent Pilot te puede ayudar, puedes elegir un espacio en mi agenda aquí: cal.com/agent-pilot. ¡Mucho éxito con las reservas!"*
    * **Estado pasa a:** `CLOSED_LOST`.

## 6. Manejo de Respuestas (Inbound) y el "Momento Debido"
Cuando el Polling detecta que el *host* respondió, el flujo es el siguiente:

1.  **Cambio de Estado:** El CRM actualiza el lead a `REPLIED_IN_PROGRESS` (detiene los *follow-ups*).
2.  **Evaluación de Triaje:**
    * *Host:* *"Hola, ¿tienen integración con Airbnb directo o usan Channel Manager?"*
3.  **Ejecución del Agente Negociador (Envío del Link):** El agente aplica su regla de oro: 1 línea de valor + Cal.com.
    * *Respuesta generada:* *"Hola, nos integramos holísticamente a tus canales para que todo se gestione directamente desde el chat sin abrir otras plataformas. Como tienes [X] propiedades, lo mejor es hacer un diagnóstico rápido para ver tu setup actual. Elige el horario que mejor te quede en este link y te lo muestro en 10 minutos: cal.com/agent-pilot"*
4.  **Actualización CRM:** El sistema puede marcar internamente que el link fue enviado.
5.  **Kill Switch (Seguridad de 2 toques):** Si el *host* sigue haciendo preguntas después de que se envió el link de Cal.com, la IA le responde una vez más y le insiste en la llamada. Si el *host* sigue sin agendar y responde una tercera vez, el sistema se bloquea (`HUMAN_TAKEOVER`) y envía una alerta por Slack/Email para tomar la venta manualmente. *"El bot hizo su trabajo, el prospecto es difícil, entra el humano".*

## 7. Directrices Técnicas

* **Formato del Link de Cal.com:** En Airbnb, a veces los links completos con `https://` son bloqueados o marcados como advertencia de seguridad para el usuario.
    * *Instrucción para el Prompt:* Obligar a la IA a escribir el link sin el protocolo, por ejemplo: `cal.com/tu-usuario/diagnostico`.
* **Pausas Humanas en el Tipeo:** Cuando la IA vaya a enviar el mensaje, Playwright no debe hacer un simple *Copy-Paste* (`page.fill`). Debe usar `page.type('texto...', { delay: 45 })` para simular que un humano está escribiendo la respuesta y evitar que Airbnb detecte patrones de bot automatizados.
* **Monitoreo del Objetivo:** Añadir un campo booleano en Prisma:
    ```prisma
    calLinkSent Boolean @default(false)
    ```
    Cada vez que la IA redacte un mensaje, el script en Node hará un `.includes('cal.com')`. Si es verdadero, marcará este campo como `true` en la base de datos para las métricas de conversión.