"use client"

import { KanbanBoard } from "@/components/dashboard/kanban/kanban-board"
import { LeadFilters } from "@/components/dashboard/lead-filters"
import { LeadDetailSheet } from "@/components/dashboard/lead-detail-sheet"
import { ManualLeadDialog } from "@/components/dashboard/manual-lead-dialog"
import { useEffect, useState, useTransition } from "react"
import { useSearchParams } from "next/navigation"
import { Lead, LeadFilters as FiltersType } from "@/lib/leads/types"
import { leadRepository } from "@/lib/leads/repository"

import { SidebarTrigger } from "@/components/ui/sidebar"

export default function PipelinePage() {
  const searchParams = useSearchParams()
  const deepLinkLeadId = searchParams.get("leadId")
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [filters, setFilters] = useState<FiltersType>({})
  const [refreshKey, setRefreshKey] = useState(0)
  const [, startTransition] = useTransition()

  useEffect(() => {
    if (!deepLinkLeadId) return

    startTransition(async () => {
      const lead = await leadRepository.getLead(deepLinkLeadId)
      if (lead) {
        setSelectedLead(lead)
      }
    })
  }, [deepLinkLeadId])

  return (
    <div className="flex h-full w-full flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/5 px-4">
        <div className="flex items-center gap-2">
          <SidebarTrigger className="md:hidden" />
          <h1 className="text-sm font-medium">Pipeline</h1>
        </div>
        <div className="flex items-center gap-2">
          <ManualLeadDialog
            onLeadCreated={(lead) => {
              setRefreshKey((value) => value + 1)
              setSelectedLead(lead)
            }}
            onOpenLead={(lead) => {
              setSelectedLead(lead)
            }}
          />
          <button
            onClick={() => {
              const ev = new KeyboardEvent("keydown", { key: "k", metaKey: true })
              document.dispatchEvent(ev)
            }}
            className="flex items-center gap-2 rounded-md bg-white/5 px-3 py-1.5 text-xs text-muted-foreground hover:bg-white/10 transition-colors"
          >
            <span>Buscar comandos...</span>
            <kbd className="font-mono text-[10px] tracking-tighter">⌘K</kbd>
          </button>
        </div>
      </header>

      <LeadFilters filters={filters} onChange={setFilters} />

      <main className="flex-1 overflow-hidden pt-4">
        <KanbanBoard
          filters={filters}
          refreshKey={refreshKey}
          onLeadSelect={setSelectedLead}
        />
      </main>
      
      <LeadDetailSheet 
        leadId={selectedLead?.id || null} 
        onClose={() => setSelectedLead(null)} 
      />
    </div>
  )
}
