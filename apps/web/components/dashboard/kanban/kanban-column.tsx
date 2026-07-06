import { useDroppable } from "@dnd-kit/core"
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { Lead, LeadStatus } from "@/lib/leads/types"
import { STATUS_LABELS } from "@/lib/leads/status-config"
import { KanbanCard } from "./kanban-card"
import { cn } from "@/lib/utils"

interface KanbanColumnProps {
  status: LeadStatus
  leads: Lead[]
  onCardClick?: (lead: Lead) => void
}

export function KanbanColumn({ status, leads, onCardClick }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: status,
  })

  const label = STATUS_LABELS[status]
  const count = leads.length
  const isEmpty = count === 0

  return (
    <div className={cn("flex flex-col w-[300px] shrink-0", isEmpty && "opacity-50 hover:opacity-100 transition-opacity")}>
      <div className="flex items-center justify-between mb-4 px-2">
        <h2 className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold flex items-center gap-2">
          {label}
          <span className="bg-white/10 text-white/70 px-1.5 py-0.5 rounded-sm text-[9px] font-mono leading-none">
            {count}
          </span>
        </h2>
      </div>

      <div
        ref={setNodeRef}
        className={cn(
          "flex-1 flex flex-col gap-3 rounded-xl p-2 transition-colors min-h-[150px]",
          isOver && "bg-white/5"
        )}
      >
        <SortableContext items={leads.map(l => l.id)} strategy={verticalListSortingStrategy}>
          {leads.map(lead => (
            <KanbanCard key={lead.id} lead={lead} onClick={() => onCardClick?.(lead)} />
          ))}
        </SortableContext>
        
        {isEmpty && !isOver && (
          <div className="h-full flex items-center justify-center text-xs text-muted-foreground/50 border border-dashed border-white/5 rounded-xl">
            Sin leads
          </div>
        )}
      </div>
    </div>
  )
}
