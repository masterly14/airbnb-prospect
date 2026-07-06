"use client"

import { useState } from "react"
import { Search, Filter, AlertCircle } from "lucide-react"
import { Input } from "@/components/ui/input"
import { LeadFilters as FiltersType } from "@/lib/leads/types"

interface LeadFiltersProps {
  filters: FiltersType
  onChange: (filters: FiltersType) => void
}

export function LeadFilters({ filters, onChange }: LeadFiltersProps) {
  const [q, setQ] = useState(filters.q || "")

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setQ(val)
    onChange({ ...filters, q: val })
  }

  const toggleAlerts = () => {
    onChange({ ...filters, alertsOnly: !filters.alertsOnly })
  }

  return (
    <div className="flex items-center gap-4 px-4 py-3 border-b border-white/5">
      <div className="relative flex-1 max-w-sm">
        <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Buscar por nombre o anuncio..."
          value={q}
          onChange={handleSearch}
          className="h-8 w-full bg-card/30 border-white/10 pl-9 text-xs focus-visible:ring-1 focus-visible:ring-white/20"
        />
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={toggleAlerts}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors border ${
            filters.alertsOnly 
              ? "bg-destructive/10 text-destructive border-destructive/20" 
              : "bg-transparent text-muted-foreground border-white/5 hover:bg-white/5"
          }`}
        >
          <AlertCircle className="h-3.5 w-3.5" />
          <span>Solo alertas</span>
        </button>

        <button className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium bg-transparent text-muted-foreground border border-white/5 hover:bg-white/5 transition-colors">
          <Filter className="h-3.5 w-3.5" />
          <span>Filtros</span>
        </button>
      </div>
    </div>
  )
}
