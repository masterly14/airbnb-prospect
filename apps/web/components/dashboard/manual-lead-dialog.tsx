"use client"

import { useEffect, useState, useTransition } from "react"
import { AlertTriangle, CheckCircle2, Plus, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { leadRepository } from "@/lib/leads/repository"
import { Lead, LeadLookupMatch, LeadStatus } from "@/lib/leads/types"
import { STATUS_LABELS } from "@/lib/leads/status-config"
import { toast } from "sonner"

type ManualLeadDialogProps = {
  onLeadCreated?: (lead: Lead) => void
  onOpenLead?: (lead: Lead) => void
}

const MARKETS = ["Bogotá", "Medellín", "Cali", "Bucaramanga"] as const

export function ManualLeadDialog({ onLeadCreated, onOpenLead }: ManualLeadDialogProps) {
  const [open, setOpen] = useState(false)
  const [lookupQuery, setLookupQuery] = useState("")
  const [lookupResults, setLookupResults] = useState<LeadLookupMatch[]>([])
  const [lookupPending, startLookup] = useTransition()
  const [submitPending, startSubmit] = useTransition()

  const [name, setName] = useState("")
  const [companyName, setCompanyName] = useState("")
  const [hostProfileUrl, setHostProfileUrl] = useState("")
  const [primaryListingUrl, setPrimaryListingUrl] = useState("")
  const [threadUrl, setThreadUrl] = useState("")
  const [market, setMarket] = useState<string>("")
  const [status, setStatus] = useState<LeadStatus>(LeadStatus.INITIAL_MSG_SENT)
  const [notes, setNotes] = useState("")

  useEffect(() => {
    if (!open) return
    if (lookupQuery.trim().length < 2) {
      setLookupResults([])
      return
    }

    const timer = window.setTimeout(() => {
      startLookup(async () => {
        try {
          const matches = await leadRepository.lookupLeads(lookupQuery.trim())
          setLookupResults(matches)
        } catch {
          setLookupResults([])
        }
      })
    }, 350)

    return () => window.clearTimeout(timer)
  }, [lookupQuery, open])

  function resetForm() {
    setLookupQuery("")
    setLookupResults([])
    setName("")
    setCompanyName("")
    setHostProfileUrl("")
    setPrimaryListingUrl("")
    setThreadUrl("")
    setMarket("")
    setStatus(LeadStatus.INITIAL_MSG_SENT)
    setNotes("")
  }

  function handleRegister() {
    if (!name.trim()) {
      toast.error("Indica el nombre del anfitrión o empresa.")
      return
    }

    startSubmit(async () => {
      try {
        const result = await leadRepository.createManualLead({
          name: name.trim(),
          companyName: companyName.trim() || undefined,
          hostProfileUrl: hostProfileUrl.trim() || undefined,
          primaryListingUrl: primaryListingUrl.trim() || undefined,
          threadUrl: threadUrl.trim() || undefined,
          market: market || undefined,
          status,
          notes: notes.trim() || undefined,
        })

        if (!result.created) {
          toast.warning("Este prospecto ya estaba registrado.", {
            description: `${result.lead.name} · ${STATUS_LABELS[result.lead.status as LeadStatus]}`,
          })
          onOpenLead?.(result.lead)
          setOpen(false)
          resetForm()
          return
        }

        toast.success("Contacto registrado en el CRM.")
        onLeadCreated?.(result.lead)
        setOpen(false)
        resetForm()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "No se pudo registrar el contacto.")
      }
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) resetForm()
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary" className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Registrar contacto
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Contacto manual</DialogTitle>
          <DialogDescription>
            Verifica si ya escribiste a alguien y registra nuevos contactos hechos fuera del
            automatismo.
          </DialogDescription>
        </DialogHeader>

        <section className="space-y-3 rounded-xl border border-white/10 bg-card/20 p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Search className="h-4 w-4 text-muted-foreground" />
            ¿Ya le escribí?
          </div>
          <Input
            value={lookupQuery}
            onChange={(event) => setLookupQuery(event.target.value)}
            placeholder="Nombre, empresa, URL de perfil, anuncio o hilo..."
          />
          {lookupQuery.trim().length >= 2 ? (
            <div className="space-y-2">
              {lookupPending ? (
                <p className="text-xs text-muted-foreground">Buscando...</p>
              ) : lookupResults.length === 0 ? (
                <p className="flex items-center gap-2 text-xs text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  No hay coincidencias en el CRM con esa búsqueda.
                </p>
              ) : (
                lookupResults.map((match) => (
                  <button
                    key={match.id}
                    type="button"
                    onClick={() =>
                      onOpenLead?.({
                        id: match.id,
                        name: match.name,
                        status: match.status,
                      } as Lead)
                    }
                    className="w-full rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-left hover:bg-amber-500/10 transition-colors"
                  >
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{match.name}</p>
                        {match.companyName ? (
                          <p className="text-xs text-muted-foreground truncate">{match.companyName}</p>
                        ) : null}
                        <p className="text-xs text-muted-foreground mt-1">
                          {STATUS_LABELS[match.status]}
                          {match.contacted ? " · Ya contactado" : ""}
                          {match.market ? ` · ${match.market}` : ""}
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-1">
                          {match.matchReasons.join(" · ")}
                        </p>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Escribe al menos 2 caracteres para buscar duplicados.
            </p>
          )}
        </section>

        <section className="space-y-4">
          <p className="text-sm font-medium">Registrar nuevo contacto</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="manual-name">Nombre del anfitrión / empresa *</Label>
              <Input
                id="manual-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Ej. Lucame Rentals"
                required
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="manual-company">Empresa / co-host (opcional)</Label>
              <Input
                id="manual-company"
                value={companyName}
                onChange={(event) => setCompanyName(event.target.value)}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="manual-profile">URL perfil Airbnb (recomendado)</Label>
              <Input
                id="manual-profile"
                value={hostProfileUrl}
                onChange={(event) => setHostProfileUrl(event.target.value)}
                placeholder="https://www.airbnb.com.co/users/show/..."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="manual-listing">URL anuncio (opcional)</Label>
              <Input
                id="manual-listing"
                value={primaryListingUrl}
                onChange={(event) => setPrimaryListingUrl(event.target.value)}
                placeholder="https://www.airbnb.com.co/rooms/..."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="manual-thread">URL conversación (opcional)</Label>
              <Input
                id="manual-thread"
                value={threadUrl}
                onChange={(event) => setThreadUrl(event.target.value)}
                placeholder="https://www.airbnb.com.co/guest/messages/..."
              />
            </div>
            <div className="space-y-2">
              <Label>Mercado</Label>
              <Select value={market} onValueChange={setMarket}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Opcional" />
                </SelectTrigger>
                <SelectContent>
                  {MARKETS.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Estado</Label>
              <Select value={status} onValueChange={(value) => setStatus(value as LeadStatus)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={LeadStatus.INITIAL_MSG_SENT}>Primer contacto enviado</SelectItem>
                  <SelectItem value={LeadStatus.HUMAN_TAKEOVER}>Conversación activa (humano)</SelectItem>
                  <SelectItem value={LeadStatus.CLOSED_LOST}>Rechazó / no interesa</SelectItem>
                  <SelectItem value={LeadStatus.CLOSED_WON}>Ganado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="manual-notes">Notas (opcional)</Label>
              <Input
                id="manual-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Ej. Primer mensaje enviado el 5 jul desde cuenta Legacy"
              />
            </div>
          </div>
        </section>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleRegister} disabled={submitPending}>
            {submitPending ? "Guardando..." : "Guardar contacto"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
