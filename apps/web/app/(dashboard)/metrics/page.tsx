"use client"

import { useEffect, useState, useTransition } from "react"
import { leadRepository } from "@/lib/leads/repository"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"

import { SidebarTrigger } from "@/components/ui/sidebar"

export default function MetricsPage() {
  const [metrics, setMetrics] = useState<any>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    startTransition(async () => {
      const data = await leadRepository.getMetrics()
      setMetrics(data)
    })
  }, [])

  if (!metrics) {
    return (
      <div className="flex h-full w-full items-center justify-center text-muted-foreground text-sm">
        Cargando métricas...
      </div>
    )
  }

  const chartData = [
    { stage: "Descubiertos", leads: metrics.total },
    { stage: "Contactados", leads: metrics.contacted },
    { stage: "Respondieron", leads: metrics.replied },
    { stage: "Link Enviado", leads: metrics.calSent },
    { stage: "Ganados", leads: metrics.won },
  ]

  const chartConfig = {
    leads: {
      label: "Leads",
      color: "var(--primary)",
    },
  }

  return (
    <div className="flex h-full w-full flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/5 px-4">
        <div className="flex items-center gap-2">
          <SidebarTrigger className="md:hidden" />
          <h1 className="text-sm font-medium">Métricas & Funnel</h1>
        </div>
      </header>
      <main className="flex-1 overflow-auto p-6">
        <div className="max-w-5xl mx-auto space-y-8">
          
          {/* KPIs */}
          <div className="grid gap-4 md:grid-cols-5">
            <div className="rounded-xl border border-white/5 bg-card/30 p-5">
              <h3 className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest">Total Leads</h3>
              <p className="mt-2 text-3xl font-light">{metrics.total}</p>
            </div>
            <div className="rounded-xl border border-white/5 bg-card/30 p-5">
              <h3 className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest">Contactados</h3>
              <p className="mt-2 text-3xl font-light">{metrics.contacted}</p>
            </div>
            <div className="rounded-xl border border-white/5 bg-card/30 p-5">
              <h3 className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest">Respondieron</h3>
              <p className="mt-2 text-3xl font-light">{metrics.replied}</p>
            </div>
            <div className="rounded-xl border border-white/5 bg-card/30 p-5">
              <h3 className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest">Link Enviado</h3>
              <p className="mt-2 text-3xl font-light text-primary">{metrics.calSent}</p>
            </div>
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5">
              <h3 className="text-[10px] font-medium text-emerald-500/70 uppercase tracking-widest">Ganados</h3>
              <p className="mt-2 text-3xl font-light text-emerald-500">{metrics.won}</p>
            </div>
          </div>

          {/* Funnel Chart */}
          <div className="rounded-xl border border-white/5 bg-card/30 p-6 h-[400px] flex flex-col">
            <h3 className="text-xs font-medium text-foreground mb-6">Funnel de Conversión</h3>
            <div className="flex-1 min-h-0">
              <ChartContainer config={chartConfig} className="h-full w-full">
                <BarChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" opacity={0.5} />
                  <XAxis 
                    dataKey="stage" 
                    tickLine={false} 
                    axisLine={false} 
                    tickMargin={10} 
                    fontSize={11} 
                    fill="var(--muted-foreground)"
                  />
                  <YAxis 
                    tickLine={false} 
                    axisLine={false} 
                    tickMargin={10} 
                    fontSize={11}
                    fill="var(--muted-foreground)"
                  />
                  <ChartTooltip cursor={{fill: 'var(--border)', opacity: 0.2}} content={<ChartTooltipContent />} />
                  <Bar dataKey="leads" fill="var(--primary)" radius={[4, 4, 0, 0]} maxBarSize={60} />
                </BarChart>
              </ChartContainer>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
