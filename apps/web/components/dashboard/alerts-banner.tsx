"use client"

import { AlertCircle, X } from "lucide-react"
import { useState, useEffect } from "react"
import { leadRepository } from "@/lib/leads/repository"
import { LeadStatus } from "@/lib/leads/types"

export function AlertsBanner() {
  const [isVisible, setIsVisible] = useState(true)
  const [takeoverCount, setTakeoverCount] = useState(0)
  const [overdueCount, setOverdueCount] = useState(0)

  useEffect(() => {
    const fetchAlerts = async () => {
      const leads = await leadRepository.listLeads({ alertsOnly: true })
      const now = new Date()
      const takeover = leads.filter((l) => l.status === LeadStatus.HUMAN_TAKEOVER)
      const overdue = leads.filter(
        (l) =>
          l.status !== LeadStatus.HUMAN_TAKEOVER &&
          l.nextFollowUpAt != null &&
          new Date(l.nextFollowUpAt) < now,
      )
      setTakeoverCount(takeover.length)
      setOverdueCount(overdue.length)
    }
    fetchAlerts().catch(() => {
      setTakeoverCount(0)
      setOverdueCount(0)
    })
  }, [])

  if (!isVisible || takeoverCount + overdueCount === 0) return null

  return (
    <div className="bg-destructive/10 border-b border-destructive/20 px-4 py-2.5 flex items-center justify-between">
      <div className="flex items-center gap-2 text-[13px] text-destructive">
        <AlertCircle className="h-4 w-4" />
        <p>
          {takeoverCount > 0 && (
            <>
              <strong>{takeoverCount} lead{takeoverCount > 1 ? 's' : ''}</strong> esperando intervención humana.
            </>
          )}
          {takeoverCount > 0 && overdueCount > 0 && " "}
          {overdueCount > 0 && (
            <>
              <strong>{overdueCount} follow-up{overdueCount > 1 ? 's' : ''}</strong> vencido{overdueCount > 1 ? 's' : ''}.
            </>
          )}
        </p>
      </div>
      <button 
        onClick={() => setIsVisible(false)}
        className="text-destructive/70 hover:text-destructive transition-colors"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
