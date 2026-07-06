import React, { useEffect, useMemo, useState } from "react"
import { LeadStatus, type CreateManualLeadInput, type LeadLookupMatch } from "@repo/crm-client"
import type { AirbnbPageContext } from "./extract-context"

export type BannerState =
  | { kind: "loading"; context: AirbnbPageContext }
  | { kind: "no_config" }
  | { kind: "free"; context: AirbnbPageContext }
  | { kind: "in_crm"; context: AirbnbPageContext; matches: LeadLookupMatch[] }
  | { kind: "ambiguous"; context: AirbnbPageContext; matches: LeadLookupMatch[] }
  | { kind: "error"; context?: AirbnbPageContext; message: string; needsConfig?: boolean }

type Props = {
  state: BannerState
  crmBaseUrl?: string
  onSave: (input: CreateManualLeadInput) => Promise<void>
  onRetry: () => void
  onOpenOptions: () => void
  onDismiss: () => void
}

const STATUS_LABELS: Record<LeadStatus, string> = {
  [LeadStatus.LEAD_DISCOVERED]: "Lead descubierto",
  [LeadStatus.INITIAL_MSG_SENT]: "Mensaje inicial enviado",
  [LeadStatus.FOLLOW_UP_1_SENT]: "Follow-up 1 enviado",
  [LeadStatus.FOLLOW_UP_2_SENT]: "Follow-up 2 enviado",
  [LeadStatus.FOLLOW_UP_3_SENT]: "Follow-up 3 enviado",
  [LeadStatus.REPLIED_IN_PROGRESS]: "Respondió, en gestión",
  [LeadStatus.HUMAN_TAKEOVER]: "Requiere operador",
  [LeadStatus.CLOSED_WON]: "Cerrado ganado",
  [LeadStatus.CLOSED_LOST]: "Cerrado perdido",
}

export function CrmAlertBanner({ state, crmBaseUrl, onSave, onRetry, onOpenOptions, onDismiss }: Props) {
  const context = "context" in state ? state.context : undefined
  const matches = "matches" in state ? state.matches : []
  const primaryMatch = matches[0]

  return (
    <div className={`crm-banner crm-banner--${state.kind}`}>
      <style>{styles}</style>
      <button className="close" aria-label="Cerrar alerta CRM" onClick={onDismiss}>
        ×
      </button>

      {state.kind === "loading" ? (
        <BannerHeader title="Consultando CRM..." description="Validando si este prospecto ya existe." />
      ) : null}

      {state.kind === "no_config" ? (
        <>
          <BannerHeader
            title="Configura la extensión"
            description="Agrega la URL del CRM y el dashboard token para validar prospectos en Airbnb."
          />
          <button className="primary" onClick={onOpenOptions}>
            Abrir opciones
          </button>
        </>
      ) : null}

      {state.kind === "in_crm" && primaryMatch ? (
        <>
          <BannerHeader
            title="Ya está en el CRM"
            description={`${primaryMatch.name} · ${STATUS_LABELS[primaryMatch.status] ?? primaryMatch.status}`}
          />
          <MatchList matches={matches} crmBaseUrl={crmBaseUrl} />
        </>
      ) : null}

      {state.kind === "ambiguous" ? (
        <>
          <BannerHeader
            title="Posibles coincidencias en CRM"
            description={`Encontré ${matches.length} coincidencias. Revisa antes de guardar.`}
          />
          <MatchList matches={matches} crmBaseUrl={crmBaseUrl} />
          {context ? <SaveLeadForm context={context} onSave={onSave} /> : null}
        </>
      ) : null}

      {state.kind === "free" && context ? (
        <>
          <BannerHeader title="No está en el CRM" description="Puedes registrarlo sin salir de Airbnb." />
          <SaveLeadForm context={context} onSave={onSave} />
        </>
      ) : null}

      {state.kind === "error" ? (
        <>
          <BannerHeader title="No se pudo validar" description={state.message} />
          <div className="actions">
            <button className="primary" onClick={state.needsConfig ? onOpenOptions : onRetry}>
              {state.needsConfig ? "Abrir opciones" : "Reintentar"}
            </button>
          </div>
        </>
      ) : null}
    </div>
  )
}

function BannerHeader({ title, description }: { title: string; description: string }) {
  return (
    <header>
      <p className="eyebrow">Airbnb CRM</p>
      <h2>{title}</h2>
      <p className="description">{description}</p>
    </header>
  )
}

function MatchList({ matches, crmBaseUrl }: { matches: LeadLookupMatch[]; crmBaseUrl?: string }) {
  const visibleMatches = matches.slice(0, 3)
  return (
    <div className="matches">
      {visibleMatches.map((match) => (
        <article className="match" key={match.id}>
          <div>
            <strong>{match.name}</strong>
            <span>{STATUS_LABELS[match.status] ?? match.status}</span>
            {match.matchReasons.length > 0 ? <small>{match.matchReasons.join(" · ")}</small> : null}
          </div>
          {crmBaseUrl ? (
            <a href={`${crmBaseUrl}/pipeline?leadId=${match.id}`} target="_blank" rel="noreferrer">
              Ver
            </a>
          ) : null}
        </article>
      ))}
    </div>
  )
}

function SaveLeadForm({ context, onSave }: { context: AirbnbPageContext; onSave: (input: CreateManualLeadInput) => Promise<void> }) {
  const [expanded, setExpanded] = useState(false)
  const [name, setName] = useState(context.name)
  const [market, setMarket] = useState(context.market ?? "")
  const [notes, setNotes] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    setName(context.name)
    setMarket(context.market ?? "")
    setNotes("")
    setError("")
  }, [context.sourceUrl, context.name, context.market])

  const payload = useMemo<CreateManualLeadInput>(
    () => ({
      name: name.trim(),
      hostProfileUrl: context.hostProfileUrl,
      primaryListingUrl: context.primaryListingUrl,
      threadUrl: context.threadUrl,
      market: market.trim() || undefined,
      status: LeadStatus.INITIAL_MSG_SENT,
      notes: notes.trim() || undefined,
    }),
    [context.hostProfileUrl, context.primaryListingUrl, context.threadUrl, market, name, notes],
  )

  async function handleSave() {
    if (!payload.name) {
      setError("Indica el nombre del anfitrión.")
      return
    }
    setPending(true)
    setError("")
    try {
      await onSave(payload)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudo guardar en el CRM.")
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="save-form">
      <button className="primary" disabled={pending} onClick={() => setExpanded((value) => !value)}>
        {expanded ? "Ocultar formulario" : "Guardar en CRM"}
      </button>
      {expanded ? (
        <div className="fields">
          <label>
            Nombre
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            Mercado
            <input placeholder="Medellín, Bogotá..." value={market} onChange={(event) => setMarket(event.target.value)} />
          </label>
          <label>
            Notas
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
          </label>
          {error ? <p className="error">{error}</p> : null}
          <button className="primary" disabled={pending} onClick={handleSave}>
            {pending ? "Guardando..." : "Confirmar guardado"}
          </button>
        </div>
      ) : null}
    </section>
  )
}

const styles = `
  .crm-banner {
    box-sizing: border-box;
    width: 360px;
    max-width: calc(100vw - 32px);
    border: 1px solid rgba(15, 23, 42, 0.12);
    border-left: 6px solid #10b981;
    border-radius: 18px;
    background: #ffffff;
    box-shadow: 0 24px 80px rgba(15, 23, 42, 0.18);
    color: #0f172a;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    line-height: 1.4;
    padding: 18px;
    position: relative;
  }

  .crm-banner--loading { border-left-color: #64748b; }
  .crm-banner--in_crm { border-left-color: #f59e0b; }
  .crm-banner--ambiguous { border-left-color: #eab308; }
  .crm-banner--error,
  .crm-banner--no_config { border-left-color: #ef4444; }

  .close {
    align-items: center;
    background: #f1f5f9;
    border: 0;
    border-radius: 999px;
    color: #334155;
    cursor: pointer;
    display: flex;
    font-size: 18px;
    height: 28px;
    justify-content: center;
    position: absolute;
    right: 12px;
    top: 12px;
    width: 28px;
  }

  .eyebrow {
    color: #64748b;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.12em;
    margin: 0 36px 6px 0;
    text-transform: uppercase;
  }

  h2 {
    font-size: 18px;
    line-height: 1.2;
    margin: 0 36px 6px 0;
  }

  .description {
    color: #475569;
    font-size: 14px;
    margin: 0 0 14px;
  }

  .matches {
    display: grid;
    gap: 8px;
    margin-top: 12px;
  }

  .match {
    align-items: center;
    background: #f8fafc;
    border-radius: 12px;
    display: flex;
    gap: 12px;
    justify-content: space-between;
    padding: 10px;
  }

  .match strong,
  .match span,
  .match small {
    display: block;
  }

  .match span,
  .match small {
    color: #64748b;
    font-size: 12px;
  }

  .match a {
    color: #0f172a;
    font-size: 13px;
    font-weight: 800;
    text-decoration: underline;
  }

  .primary {
    background: #0f172a;
    border: 0;
    border-radius: 999px;
    color: #ffffff;
    cursor: pointer;
    font: inherit;
    font-size: 13px;
    font-weight: 800;
    padding: 10px 14px;
  }

  .primary:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .actions,
  .save-form {
    margin-top: 14px;
  }

  .fields {
    display: grid;
    gap: 10px;
    margin-top: 12px;
  }

  label {
    color: #334155;
    display: grid;
    font-size: 12px;
    font-weight: 800;
    gap: 5px;
  }

  input,
  textarea {
    border: 1px solid #cbd5e1;
    border-radius: 10px;
    box-sizing: border-box;
    color: #0f172a;
    font: inherit;
    font-size: 13px;
    padding: 9px 10px;
    width: 100%;
  }

  textarea {
    min-height: 64px;
    resize: vertical;
  }

  .error {
    color: #b91c1c;
    font-size: 13px;
    font-weight: 700;
    margin: 0;
  }
`
