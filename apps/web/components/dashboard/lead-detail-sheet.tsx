"use client"

import { LeadDetail, LeadStatus } from "@/lib/leads/types"
import { leadRepository } from "@/lib/leads/repository"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { useEffect, useState, useTransition } from "react"
import { MessageTimeline } from "./message-timeline"
import { Building, ExternalLink, Send, UserCog } from "lucide-react"

interface LeadDetailSheetProps {
  leadId: string | null
  onClose: () => void
}

export function LeadDetailSheet({ leadId, onClose }: LeadDetailSheetProps) {
  const [lead, setLead] = useState<LeadDetail | null>(null)
  const [isPending, startTransition] = useTransition()
  const [draft, setDraft] = useState("")

  useEffect(() => {
    if (!leadId) {
      setLead(null)
      return
    }
    startTransition(async () => {
      const data = await leadRepository.getLead(leadId)
      setLead(data)
    })
  }, [leadId])

  const handleSend = async () => {
    if (!draft.trim() || !leadId) return
    const content = draft
    setDraft("")
    const newMsg = await leadRepository.sendManualMessage(leadId, content)
    if (newMsg) {
      setLead(prev => prev ? { ...prev, messages: [...prev.messages, newMsg] } : prev)
    }
  }

  const handleTakeover = async () => {
    if (!leadId) return
    const updated = await leadRepository.takeover(leadId)
    if (updated) {
      setLead(prev => (prev ? { ...prev, status: updated.status } : prev))
    }
  }

  const canTakeover =
    lead != null &&
    lead.status !== LeadStatus.HUMAN_TAKEOVER &&
    lead.status !== LeadStatus.CLOSED_WON &&
    lead.status !== LeadStatus.CLOSED_LOST

  return (
    <Sheet open={!!leadId} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full sm:max-w-[600px] border-l-white/5 bg-background p-0 flex flex-col gap-0 outline-none overflow-hidden">
        {/* Usamos un Título sr-only o minimalista para accesibilidad si es necesario */}
        <SheetTitle className="sr-only">Detalle del Lead</SheetTitle>

        {lead ? (
          <>
            {/* Header Hero */}
            <div className="flex flex-col gap-4 p-6 shrink-0">
              <div className="flex items-start gap-4">
                <div className="h-16 w-16 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-xl text-primary font-medium shrink-0">
                  {lead.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-xl font-medium tracking-tight truncate">{lead.name}</h2>
                  <a 
                    href={lead.primaryListingUrl} 
                    target="_blank"
                    rel="noreferrer"
                    className="group flex items-center gap-1 text-sm text-muted-foreground mt-1 hover:text-foreground transition-colors w-fit"
                  >
                    <Building className="h-3.5 w-3.5" />
                    <span className="truncate">{lead.primaryListingName || "Anuncio Principal"}</span>
                    <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </a>
                </div>
                {canTakeover && (
                  <button
                    onClick={handleTakeover}
                    className="shrink-0 flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors"
                    title="Pausar la IA y pasar el lead a intervención humana"
                  >
                    <UserCog className="h-3.5 w-3.5" />
                    Pasar a humano
                  </button>
                )}
              </div>

              {/* Tags / IA Metadata */}
              {(lead.companyName || lead.businessScale || lead.painPoints) && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {lead.companyName && (
                    <span className="bg-white/5 text-[11px] px-2.5 py-1 rounded-full text-foreground">
                      {lead.companyName}
                    </span>
                  )}
                  {lead.businessScale && (
                    <span className="bg-white/5 text-[11px] px-2.5 py-1 rounded-full text-muted-foreground">
                      {lead.businessScale}
                    </span>
                  )}
                  {lead.painPoints && (
                    <span className="bg-destructive/10 text-[11px] px-2.5 py-1 rounded-full text-destructive">
                      {lead.painPoints}
                    </span>
                  )}
                </div>
              )}

              {/* Executive Summary */}
              {lead.executiveSummary && (
                <div className="mt-2 text-[13px] text-foreground/80 leading-relaxed">
                  {lead.executiveSummary}
                </div>
              )}
            </div>

            {/* Timeline Scrollable Area */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <MessageTimeline messages={lead.messages} />
            </div>

            {/* Sticky Input Area */}
            <div className="shrink-0 p-4 border-t border-white/5 bg-background">
              <div className="relative">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Escribir mensaje manual..."
                  className="w-full bg-card/30 border border-white/10 rounded-xl px-4 py-3 text-[13px] resize-none focus:outline-none focus:ring-1 focus:ring-white/20 min-h-[60px] pr-12"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleSend()
                    }
                  }}
                />
                <button 
                  onClick={handleSend}
                  disabled={!draft.trim()}
                  className="absolute bottom-3 right-3 p-1.5 bg-primary text-primary-foreground rounded-lg disabled:opacity-50 hover:bg-primary/90 transition-colors"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            {isPending ? "Cargando..." : "No se encontró el lead."}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
