"use client"

import {
  AlertTriangle,
  ArrowUpRight,
  MessageSquare,
  Send,
  Target,
  TrendingUp,
  Users,
} from "lucide-react"
import Link from "next/link"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts"

import { AccountStatusBadge } from "@/components/dashboard/accounts/account-status-badge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { Progress } from "@/components/ui/progress"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useIsMobile } from "@/hooks/use-mobile"
import { fetchDashboardStats } from "@/lib/dashboard/api-client"
import type { DashboardStats, PeriodMetrics } from "@/lib/dashboard/types"
import type { DashboardPeriod } from "@/lib/dashboard/time-range"
import { STATUS_LABELS } from "@/lib/leads/status-config"
import { cn } from "@/lib/utils"
import { useEffect, useMemo, useState, useTransition } from "react"

const PERIOD_LABELS: Record<DashboardPeriod, string> = {
  day: "Hoy",
  week: "Semana",
  month: "Mes",
}

const trendChartConfig = {
  cold: { label: "Mensajes fríos", color: "var(--chart-1)" },
  replies: { label: "Respuestas", color: "var(--chart-2)" },
  handoffs: { label: "Handoffs", color: "var(--chart-3)" },
}

const funnelChartConfig = {
  count: { label: "Leads", color: "var(--chart-1)" },
}

function pct(value: number | null, suffix = "%") {
  if (value == null) return "—"
  return `${value}${suffix}`
}

function progressPct(current: number, target: number) {
  if (target <= 0) return 0
  return Math.min(100, Math.round((current / target) * 100))
}

function formatUpdatedAt(iso: string, compact: boolean) {
  const date = new Date(iso)
  if (compact) {
    return date.toLocaleString("es-CO", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    })
  }
  return date.toLocaleString("es-CO")
}

function KpiCard({
  title,
  value,
  hint,
  accent,
  icon: Icon,
}: {
  title: string
  value: string | number
  hint?: string
  accent?: "success" | "warning" | "default"
  icon: React.ComponentType<{ className?: string }>
}) {
  return (
    <Card size="sm" className="bg-card/40 ring-white/5">
      <CardContent className="space-y-2 sm:space-y-3">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground sm:text-[11px]">
            {title}
          </p>
          <Icon className="size-4 shrink-0 text-muted-foreground" />
        </div>
        <p
          className={cn(
            "text-2xl font-light tabular-nums sm:text-3xl",
            accent === "success" && "text-emerald-400",
            accent === "warning" && "text-amber-400",
          )}
        >
          {value}
        </p>
        {hint ? (
          <p className="text-[11px] leading-relaxed text-muted-foreground sm:text-xs">{hint}</p>
        ) : null}
      </CardContent>
    </Card>
  )
}

function PeriodKpis({
  metrics,
  target,
  period,
}: {
  metrics: PeriodMetrics
  target: number
  period: DashboardPeriod
}) {
  const targetLabel =
    period === "day" ? "objetivo diario" : period === "week" ? "objetivo semanal" : "objetivo mensual"

  return (
    <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 xl:grid-cols-4 xl:gap-4">
      <KpiCard
        title="Mensajes fríos"
        value={metrics.coldMessagesSent}
        hint={`${progressPct(metrics.coldMessagesSent, target)}% del ${targetLabel} (${target})`}
        icon={Send}
      />
      <KpiCard
        title="Primeros contactos"
        value={metrics.firstContacts}
        hint={`${metrics.leadsDiscovered} leads descubiertos`}
        icon={Users}
      />
      <KpiCard
        title="Respuestas"
        value={metrics.repliesReceived}
        hint={`Tasa de respuesta: ${pct(metrics.replyRate)}`}
        icon={MessageSquare}
      />
      <KpiCard
        title="Handoffs"
        value={metrics.humanTakeovers}
        hint={`${metrics.closedWon} ganados · ${metrics.closedLost} perdidos · ${pct(metrics.handoffRate)} handoff`}
        accent={metrics.humanTakeovers > 0 ? "success" : "default"}
        icon={TrendingUp}
      />
    </div>
  )
}

function AccountsMobileList({ accounts }: { accounts: DashboardStats["accounts"] }) {
  if (accounts.length === 0) {
    return <p className="text-sm text-muted-foreground">No hay cuentas configuradas</p>
  }

  return (
    <div className="space-y-3 md:hidden">
      {accounts.map((account) => (
        <div
          key={account.id}
          className="rounded-2xl border border-white/5 bg-muted/20 p-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{account.label}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {account.market ?? "Sin mercado"}
              </p>
            </div>
            <AccountStatusBadge status={account.status} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-center">
            <div className="rounded-xl bg-background/50 px-2 py-2">
              <p className="text-lg font-light tabular-nums">{account.messagesSentToday}</p>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Hoy</p>
            </div>
            <div className="rounded-xl bg-background/50 px-2 py-2">
              <p className="text-lg font-light tabular-nums">{account.waveMessagesSent}</p>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Oleada</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4 p-3 sm:space-y-6 sm:p-6">
      <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-24 rounded-4xl sm:h-28" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-4xl sm:h-72" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-72 rounded-4xl sm:h-80" />
        <Skeleton className="h-72 rounded-4xl sm:h-80" />
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const isMobile = useIsMobile()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [period, setPeriod] = useState<DashboardPeriod>("day")
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  useEffect(() => {
    startTransition(async () => {
      try {
        const data = await fetchDashboardStats()
        setStats(data)
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : "No se pudieron cargar las estadísticas")
      }
    })
  }, [])

  const funnelData = useMemo(() => {
    if (!stats) return []
    return [
      { stage: "Total", short: "Total", count: stats.funnel.total },
      { stage: "Contactados", short: "Cont.", count: stats.funnel.contacted },
      { stage: "Respondieron", short: "Resp.", count: stats.funnel.replied },
      { stage: "Handoff", short: "Hand.", count: stats.funnel.handoff },
      { stage: "Ganados", short: "Gan.", count: stats.funnel.won },
    ]
  }, [stats])

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-4 sm:p-6">
        <Alert variant="destructive" className="max-w-lg">
          <AlertTriangle className="size-4" />
          <AlertTitle>Error al cargar el dashboard</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    )
  }

  if (!stats) return <DashboardSkeleton />

  const periodMetrics = stats.periods[period]
  const chartHeight = isMobile ? 220 : 280
  const chartMargin = isMobile
    ? { left: -8, right: 4, top: 4, bottom: 0 }
    : { left: -16, right: 8, top: 8, bottom: 0 }

  const hasAlerts =
    stats.alerts.humanTakeover > 0 ||
    stats.alerts.overdueFollowUps > 0 ||
    stats.alerts.lowRunwayMarkets.length > 0

  return (
    <div className="flex h-full w-full min-w-0 flex-col">
      <header className="flex shrink-0 flex-col gap-3 border-b border-white/5 px-3 py-3 sm:h-14 sm:flex-row sm:items-center sm:justify-between sm:px-4 sm:py-0">
        <div className="flex min-w-0 items-center gap-2">
          <SidebarTrigger className="shrink-0 md:hidden" />
          <div className="min-w-0">
            <h1 className="truncate text-sm font-medium">Dashboard</h1>
            <p className="hidden text-[11px] text-muted-foreground sm:block">
              Prospección Airbnb · ICP 10–25 props · superhost
            </p>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 sm:justify-end">
          <Badge variant="outline" className="max-[479px]:hidden sm:inline-flex">
            <Target className="size-3" />
            Meta ~{stats.targets.weeklyColdMessages}/sem
          </Badge>
          <Link
            href="/pipeline"
            className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground sm:py-1.5"
            aria-label="Ver pipeline"
          >
            <span className="hidden min-[480px]:inline">Ver pipeline</span>
            <ArrowUpRight className="size-3.5 shrink-0" />
          </Link>
        </div>
      </header>

      <main className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
        <div className="dashboard-content mx-auto w-full max-w-7xl space-y-4 p-3 sm:space-y-6 sm:p-4 md:p-6">
          {hasAlerts ? (
            <Alert className="border-amber-500/30 bg-amber-500/5">
              <AlertTriangle className="size-4 shrink-0 text-amber-400" />
              <AlertTitle className="text-amber-300">Atención operativa</AlertTitle>
              <AlertDescription className="text-sm leading-relaxed text-amber-100/80">
                {stats.alerts.humanTakeover > 0 && (
                  <span>
                    {stats.alerts.humanTakeover} lead
                    {stats.alerts.humanTakeover > 1 ? "s" : ""} en handoff humano.{" "}
                  </span>
                )}
                {stats.alerts.overdueFollowUps > 0 && (
                  <span>
                    {stats.alerts.overdueFollowUps} follow-up
                    {stats.alerts.overdueFollowUps > 1 ? "s" : ""} vencido
                    {stats.alerts.overdueFollowUps > 1 ? "s" : ""}.{" "}
                  </span>
                )}
                {stats.alerts.lowRunwayMarkets.length > 0 && (
                  <span>
                    Pipeline ICP bajo en {stats.alerts.lowRunwayMarkets.join(", ")} (&lt; 1 semana).
                  </span>
                )}
              </AlertDescription>
            </Alert>
          ) : null}

          <Tabs
            value={period}
            onValueChange={(value) => setPeriod(value as DashboardPeriod)}
            className="min-w-0"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <TabsList className="grid h-10 w-full grid-cols-3 sm:w-auto">
                {(Object.keys(PERIOD_LABELS) as DashboardPeriod[]).map((key) => (
                  <TabsTrigger key={key} value={key} className="px-2 text-xs sm:px-3 sm:text-sm">
                    {PERIOD_LABELS[key]}
                  </TabsTrigger>
                ))}
              </TabsList>
              <p className="text-[11px] text-muted-foreground sm:text-xs">
                Actualizado {formatUpdatedAt(stats.generatedAt, isMobile)}
              </p>
            </div>

            {(Object.keys(PERIOD_LABELS) as DashboardPeriod[]).map((key) => (
              <TabsContent key={key} value={key} className="mt-3 space-y-4 sm:mt-4 sm:space-y-6">
                <PeriodKpis
                  metrics={stats.periods[key]}
                  target={
                    key === "day"
                      ? stats.targets.dailyColdMessages
                      : key === "week"
                        ? stats.targets.weeklyColdMessages
                        : stats.targets.monthlyColdMessages
                  }
                  period={key}
                />
              </TabsContent>
            ))}
          </Tabs>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card className="min-w-0 bg-card/40 ring-white/5">
              <CardHeader className="space-y-1">
                <CardTitle className="text-base sm:text-lg">Cuotas por ciudad (hoy)</CardTitle>
                <CardDescription className="text-xs sm:text-sm">
                  Bogotá / Medellín · {stats.targets.dailyPerCity["Bogotá"]}/día por ciudad
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 sm:space-y-5">
                {Object.entries(stats.cityQuotas).map(([market, quota]) => (
                  <div key={market} className="space-y-2">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate">{market}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {quota.sent}/{quota.quota}
                      </span>
                    </div>
                    <Progress value={quota.pct} className="h-2" />
                  </div>
                ))}
                <div className="rounded-2xl bg-muted/40 px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground sm:px-4 sm:py-3 sm:text-xs">
                  Total hoy: {periodMetrics.coldMessagesSent}/{stats.targets.dailyColdMessages}{" "}
                  mensajes fríos (
                  {progressPct(periodMetrics.coldMessagesSent, stats.targets.dailyColdMessages)}%)
                </div>
              </CardContent>
            </Card>

            <Card className="min-w-0 bg-card/40 ring-white/5">
              <CardHeader className="space-y-1">
                <CardTitle className="text-base sm:text-lg">Pipeline ICP en cola</CardTitle>
                <CardDescription className="text-xs sm:text-sm">
                  Leads ICP listos · alerta si &lt; 7 días de inventario
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 sm:space-y-4">
                {stats.icpPipeline.map((market) => (
                  <div
                    key={market.market}
                    className={cn(
                      "flex items-center justify-between gap-3 rounded-2xl border px-3 py-3 sm:px-4",
                      market.lowRunway
                        ? "border-amber-500/30 bg-amber-500/5"
                        : "border-white/5 bg-muted/20",
                    )}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{market.market}</p>
                      <p className="text-xs text-muted-foreground">
                        {market.discovered} leads ICP
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-lg font-light tabular-nums">
                        {market.daysOfRunway ?? "—"}
                      </p>
                      <p className="text-[10px] text-muted-foreground sm:text-[11px]">días cola</p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
            <Card className="min-w-0 bg-card/40 ring-white/5 xl:col-span-3">
              <CardHeader className="space-y-1">
                <CardTitle className="text-base sm:text-lg">Tendencia (14 días)</CardTitle>
                <CardDescription className="text-xs sm:text-sm">
                  Mensajes fríos, respuestas y handoffs
                </CardDescription>
              </CardHeader>
              <CardContent className="min-w-0">
                <ChartContainer
                  config={trendChartConfig}
                  className="aspect-auto w-full min-w-0"
                  style={{ height: chartHeight }}
                >
                  <AreaChart data={stats.trend} margin={chartMargin}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis
                      dataKey="label"
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      minTickGap={isMobile ? 12 : 24}
                      interval={isMobile ? 1 : 0}
                      tick={{ fontSize: isMobile ? 10 : 11 }}
                      angle={isMobile ? -35 : 0}
                      textAnchor={isMobile ? "end" : "middle"}
                      height={isMobile ? 48 : 30}
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      width={isMobile ? 24 : 28}
                      tick={{ fontSize: isMobile ? 10 : 11 }}
                    />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <ChartLegend
                      content={<ChartLegendContent />}
                      wrapperStyle={{ fontSize: isMobile ? 11 : 12 }}
                    />
                    <Area
                      type="monotone"
                      dataKey="cold"
                      stackId="a"
                      stroke="var(--color-cold)"
                      fill="var(--color-cold)"
                      fillOpacity={0.18}
                    />
                    <Area
                      type="monotone"
                      dataKey="replies"
                      stackId="b"
                      stroke="var(--color-replies)"
                      fill="var(--color-replies)"
                      fillOpacity={0.18}
                    />
                    <Area
                      type="monotone"
                      dataKey="handoffs"
                      stackId="c"
                      stroke="var(--color-handoffs)"
                      fill="var(--color-handoffs)"
                      fillOpacity={0.18}
                    />
                  </AreaChart>
                </ChartContainer>
              </CardContent>
            </Card>

            <Card className="min-w-0 bg-card/40 ring-white/5 xl:col-span-2">
              <CardHeader className="space-y-1">
                <CardTitle className="text-base sm:text-lg">Funnel de conversión</CardTitle>
                <CardDescription className="text-xs sm:text-sm">
                  Embudo acumulado del CRM
                </CardDescription>
              </CardHeader>
              <CardContent className="min-w-0">
                <ChartContainer
                  config={funnelChartConfig}
                  className="aspect-auto w-full min-w-0"
                  style={{ height: chartHeight }}
                >
                  <BarChart data={funnelData} margin={chartMargin}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis
                      dataKey={isMobile ? "short" : "stage"}
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      tick={{ fontSize: isMobile ? 10 : 11 }}
                      interval={0}
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      width={isMobile ? 24 : 28}
                      tick={{ fontSize: isMobile ? 10 : 11 }}
                    />
                    <ChartTooltip
                      content={
                        <ChartTooltipContent
                          labelFormatter={(_, payload) => {
                            const item = payload?.[0]?.payload as { stage?: string } | undefined
                            return item?.stage ?? ""
                          }}
                        />
                      }
                    />
                    <Bar
                      dataKey="count"
                      fill="var(--color-count)"
                      radius={[6, 6, 0, 0]}
                      maxBarSize={isMobile ? 36 : 48}
                    />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="min-w-0 bg-card/40 ring-white/5 lg:col-span-1">
              <CardHeader className="space-y-1">
                <CardTitle className="text-base sm:text-lg">Estados del pipeline</CardTitle>
                <CardDescription className="text-xs sm:text-sm">
                  Distribución actual
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2.5 sm:space-y-3">
                {stats.pipelineByStatus.map((row) => (
                  <div
                    key={row.status}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="min-w-0 truncate text-muted-foreground">
                      {STATUS_LABELS[row.status as keyof typeof STATUS_LABELS] ?? row.status}
                    </span>
                    <span className="shrink-0 font-medium tabular-nums">{row.count}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="min-w-0 bg-card/40 ring-white/5 lg:col-span-2">
              <CardHeader className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <CardTitle className="text-base sm:text-lg">Cuentas de prospección</CardTitle>
                  <CardDescription className="text-xs sm:text-sm">
                    Rotación en cascada ·{" "}
                    {stats.accounts.filter((a) => a.status === "ACTIVE").length} activas
                  </CardDescription>
                </div>
                <Link
                  href="/settings/accounts"
                  className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
                >
                  Gestionar
                </Link>
              </CardHeader>
              <CardContent className="min-w-0">
                <AccountsMobileList accounts={stats.accounts} />
                <div className="hidden md:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Cuenta</TableHead>
                        <TableHead>Mercado</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead className="text-right">Hoy</TableHead>
                        <TableHead className="text-right">Oleada</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stats.accounts.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="text-muted-foreground">
                            No hay cuentas configuradas
                          </TableCell>
                        </TableRow>
                      ) : (
                        stats.accounts.map((account) => (
                          <TableRow key={account.id}>
                            <TableCell className="max-w-[140px] truncate font-medium">
                              {account.label}
                            </TableCell>
                            <TableCell>{account.market ?? "—"}</TableCell>
                            <TableCell>
                              <AccountStatusBadge status={account.status} />
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {account.messagesSentToday}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {account.waveMessagesSent}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </div>

          {stats.recentBlocks.length > 0 ? (
            <Card className="min-w-0 bg-card/40 ring-white/5">
              <CardHeader className="space-y-1">
                <CardTitle className="text-base sm:text-lg">Bloqueos recientes</CardTitle>
                <CardDescription className="text-xs sm:text-sm">
                  Rate limits, identidad y otros eventos
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {stats.recentBlocks.map((block) => (
                  <div
                    key={block.id}
                    className="flex flex-col gap-2 rounded-2xl border border-white/5 bg-muted/20 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{block.accountLabel}</p>
                      <p className="text-xs text-muted-foreground">{block.type}</p>
                    </div>
                    <p className="shrink-0 text-[11px] text-muted-foreground sm:text-xs">
                      {new Date(block.occurredAt).toLocaleString("es-CO", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </main>
    </div>
  )
}
