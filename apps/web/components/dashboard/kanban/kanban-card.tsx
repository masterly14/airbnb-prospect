import { Lead } from "@/lib/leads/types"
import { cn } from "@/lib/utils"
import { Home, MoreHorizontal, Clock, AlertCircle, Star } from "lucide-react"
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { LeadStatus } from "@/lib/leads/types"

interface KanbanCardProps {
  lead: Lead
  isOverlay?: boolean
  onClick?: () => void
}

export function KanbanCard({ lead, isOverlay, onClick }: KanbanCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: lead.id, data: lead })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  }

  const isOverdue = lead.nextFollowUpAt && new Date(lead.nextFollowUpAt) < new Date()
  const isTakeover = lead.status === LeadStatus.HUMAN_TAKEOVER
  
  let borderColor = "border-white/5"
  if (isTakeover) borderColor = "border-l-destructive border-t-white/5 border-r-white/5 border-b-white/5 border-l-2"
  else if (isOverdue) borderColor = "border-l-amber-500/50 border-t-white/5 border-r-white/5 border-b-white/5 border-l-2"

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick?.()
        }
      }}
      tabIndex={0}
      className={cn(
        "group relative flex flex-col gap-2 rounded-xl bg-card/30 p-3 text-left outline-none",
        "border transition-all duration-200 hover:bg-card/60 hover:border-white/10 cursor-grab active:cursor-grabbing",
        borderColor,
        isOverlay && "bg-card rotate-2 opacity-90 shadow-2xl scale-105 border-white/20"
      )}
    >
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 overflow-hidden">
          <div className="flex items-center gap-1 rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            <Home className="h-3 w-3" />
            <span>{lead.totalProperties}</span>
          </div>
          {lead.isSuperhost && (
            <div className="flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
              <Star className="h-3 w-3" />
              <span>Superhost</span>
            </div>
          )}
          <span className="truncate text-[13px] font-medium text-foreground">
            {lead.name}
          </span>
        </div>
        <button 
          className="opacity-0 transition-opacity group-hover:opacity-100 flex h-5 w-5 items-center justify-center rounded hover:bg-white/10 text-muted-foreground"
          onClick={(e) => { e.stopPropagation(); /* TODO actions menu */ }}
        >
          <MoreHorizontal className="h-3 w-3" />
        </button>
      </div>

      {/* Description */}
      <div className="truncate text-[12px] text-muted-foreground">
        {lead.primaryListingName || lead.primaryListingUrl}
      </div>

      {/* Meta row */}
      <div className="flex items-center gap-3 text-[10px] text-muted-foreground mt-1">
        <div className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          <span>{/* Fake relative time */ "Hace 2h"}</span>
        </div>
        {isTakeover && (
          <div className="flex items-center gap-1 text-destructive">
            <AlertCircle className="h-3 w-3" />
            <span>Intervención</span>
          </div>
        )}
      </div>
    </div>
  )
}
