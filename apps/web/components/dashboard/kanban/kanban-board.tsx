"use client"

import { useState, useEffect, useTransition } from "react"
import { 
  DndContext, 
  DragOverlay, 
  closestCorners, 
  KeyboardSensor, 
  PointerSensor, 
  useSensor, 
  useSensors,
  DragStartEvent,
  DragOverEvent,
  DragEndEvent,
  defaultDropAnimationSideEffects
} from "@dnd-kit/core"
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable"

import { Lead, LeadStatus } from "@/lib/leads/types"
import { LEAD_STATUS_ORDER } from "@/lib/leads/status-config"
import { leadRepository } from "@/lib/leads/repository"
import { LeadFilters as FiltersType } from "@/lib/leads/types"
import { KanbanColumn } from "./kanban-column"
import { KanbanCard } from "./kanban-card"
import { toast } from "sonner"

export function KanbanBoard({ 
  onLeadSelect,
  filters,
  refreshKey = 0,
}: { 
  onLeadSelect?: (lead: Lead) => void
  filters: FiltersType
  refreshKey?: number
}) {
  const [leads, setLeads] = useState<Lead[]>([])
  const [activeLead, setActiveLead] = useState<Lead | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    startTransition(async () => {
      const data = await leadRepository.listLeads(filters)
      setLeads(data)
    })
  }, [filters, refreshKey])

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event
    const lead = leads.find(l => l.id === active.id)
    if (lead) setActiveLead(lead)
  }

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event
    if (!over) return

    const activeId = active.id
    const overId = over.id

    const activeLead = leads.find(l => l.id === activeId)
    const overLead = leads.find(l => l.id === overId)
    
    if (!activeLead) return

    const activeStatus = activeLead.status
    const overStatus = overLead ? overLead.status : (over.id as LeadStatus)

    if (activeStatus !== overStatus) {
      setLeads((prev) => {
        const activeItems = prev.filter(l => l.status === activeStatus)
        const overItems = prev.filter(l => l.status === overStatus)
        const activeIndex = activeItems.findIndex(l => l.id === activeId)
        let overIndex = overItems.findIndex(l => l.id === overId)

        if (overIndex === -1) {
          overIndex = overItems.length + 1
        }

        const newLeads = [...prev]
        const globalActiveIndex = newLeads.findIndex(l => l.id === activeId)
        newLeads[globalActiveIndex] = { ...newLeads[globalActiveIndex], status: overStatus }
        
        return newLeads
      })
    }
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    setActiveLead(null)

    if (!over) return

    const activeId = active.id as string
    const overId = over.id

    const lead = leads.find(l => l.id === activeId)
    if (!lead) return

    // Optmistic update happened in dragOver, we just need to reorder within the same column if needed
    // But for this simple implementation, we mainly care about status changes.
    // Let's persist the new status.
    const newStatus = lead.status

    try {
      await leadRepository.updateLeadStatus(activeId, newStatus)
      // toast.success(`Lead movido a ${newStatus}`)
    } catch (err) {
      toast.error("Error al mover el lead")
      // Revertir (en un caso real, re-fetch)
    }
  }

  const leadsByStatus = LEAD_STATUS_ORDER.reduce((acc, status) => {
    acc[status] = leads.filter(l => l.status === status)
    return acc
  }, {} as Record<LeadStatus, Lead[]>)

  const dropAnimation = {
    sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: "0.5" } } }),
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex h-full w-full overflow-x-auto hide-scrollbar gap-4 px-2 pb-4">
        {LEAD_STATUS_ORDER.map((status) => (
          <KanbanColumn 
            key={status} 
            status={status} 
            leads={leadsByStatus[status]} 
            onCardClick={onLeadSelect}
          />
        ))}
      </div>

      <DragOverlay dropAnimation={dropAnimation}>
        {activeLead ? <KanbanCard lead={activeLead} isOverlay /> : null}
      </DragOverlay>
    </DndContext>
  )
}
