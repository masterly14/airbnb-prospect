"use client"

import { Suspense, useEffect, useState, useTransition } from "react"
import { useSearchParams } from "next/navigation"
import { AccountStatus } from "@repo/db/client"
import { CheckCircle2 } from "lucide-react"
import { SidebarTrigger } from "@/components/ui/sidebar"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { AccountForm } from "@/components/dashboard/accounts/account-form"
import { AccountMarketSelect } from "@/components/dashboard/accounts/account-market-select"
import { AccountStatusBadge } from "@/components/dashboard/accounts/account-status-badge"
import { connectComposio, fetchAccounts, updateAccountRequest } from "@/lib/accounts/api-client"
import type { ProspectAccountMarket } from "@/lib/accounts/markets"
import type { ProspectAccountSummary } from "@/lib/accounts/types"
import { format } from "date-fns"
import { es } from "date-fns/locale"

function AccountsSettingsContent() {
  const searchParams = useSearchParams()
  const [accounts, setAccounts] = useState<ProspectAccountSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [banner, setBanner] = useState<string | null>(null)
  const [connectingId, setConnectingId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function loadAccounts() {
    startTransition(async () => {
      try {
        setError(null)
        const data = await fetchAccounts()
        setAccounts(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al cargar cuentas")
      }
    })
  }

  useEffect(() => {
    loadAccounts()
  }, [])

  useEffect(() => {
    if (searchParams.get("connected") === "1") {
      setBanner("Gmail conectado correctamente.")
    } else if (searchParams.get("error")) {
      setBanner(`Error al conectar Gmail: ${searchParams.get("error")}`)
    }
  }, [searchParams])

  async function activateAccount(id: string) {
    startTransition(async () => {
      try {
        const updated = await updateAccountRequest(id, { status: AccountStatus.ACTIVE })
        setAccounts((prev) => prev.map((a) => (a.id === id ? updated : a)))
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al activar cuenta")
      }
    })
  }

  async function updateAccountMarket(id: string, market: ProspectAccountMarket) {
    startTransition(async () => {
      try {
        setError(null)
        const updated = await updateAccountRequest(id, { market })
        setAccounts((prev) => prev.map((a) => (a.id === id ? updated : a)))
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al actualizar ciudad")
      }
    })
  }

  async function handleConnectGmail(accountId: string) {
    setConnectingId(accountId)
    setError(null)
    try {
      await connectComposio(accountId)
    } catch (err) {
      setConnectingId(null)
      setError(err instanceof Error ? err.message : "Error al conectar Gmail")
    }
  }

  return (
    <div className="flex h-full w-full flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/5 px-4">
        <div className="flex items-center gap-2">
          <SidebarTrigger className="md:hidden" />
          <h1 className="text-sm font-medium">Cuentas de prospección</h1>
        </div>
        <Button variant="outline" size="sm" onClick={loadAccounts} disabled={isPending}>
          Actualizar
        </Button>
      </header>

      <main className="flex-1 overflow-auto p-6 space-y-6">
        <AccountForm
          onCreated={(account) => {
            setAccounts((prev) => [account, ...prev])
          }}
        />

        {banner ? (
          <p className="text-sm text-emerald-400 border border-emerald-500/20 bg-emerald-500/10 rounded-lg px-4 py-3">
            {banner}
          </p>
        ) : null}

        {error ? <p className="text-sm text-red-400">{error}</p> : null}

        <p className="text-xs text-muted-foreground">
          Conecta el Gmail que recibe los OTP de Airbnb para cada cuenta. Debe ser el mismo inbox
          asociado al email de Airbnb.
        </p>

        <div className="rounded-xl border border-white/5 bg-card/30 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cuenta</TableHead>
                <TableHead>Ciudad</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Gmail</TableHead>
                <TableHead>Msgs hoy</TableHead>
                <TableHead>Oleada</TableHead>
                <TableHead>Cooldown</TableHead>
                <TableHead>Proxy</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                    {isPending ? "Cargando..." : "No hay cuentas registradas"}
                  </TableCell>
                </TableRow>
              ) : (
                accounts.map((account) => (
                  <TableRow key={account.id}>
                    <TableCell>
                      <div className="font-medium">{account.label}</div>
                      <div className="text-xs text-muted-foreground">{account.airbnbEmail}</div>
                    </TableCell>
                    <TableCell>
                      <AccountMarketSelect
                        value={account.market}
                        onValueChange={(market) => updateAccountMarket(account.id, market)}
                        disabled={isPending}
                        size="sm"
                      />
                    </TableCell>
                    <TableCell>
                      <AccountStatusBadge status={account.status} />
                    </TableCell>
                    <TableCell>
                      {account.composioConnectionId ? (
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-1.5 text-xs text-emerald-400">
                            <CheckCircle2 className="size-3.5" />
                            <span>
                              Conectado
                              {account.composioConnectedAt
                                ? ` · ${format(account.composioConnectedAt, "dd MMM yyyy", { locale: es })}`
                                : ""}
                            </span>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            disabled={connectingId === account.id || isPending}
                            onClick={() => handleConnectGmail(account.id)}
                          >
                            {connectingId === account.id ? "Redirigiendo..." : "Reconectar Gmail"}
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={connectingId === account.id || isPending}
                          onClick={() => handleConnectGmail(account.id)}
                        >
                          {connectingId === account.id ? "Redirigiendo..." : "Conectar Gmail"}
                        </Button>
                      )}
                    </TableCell>
                    <TableCell>{account.messagesSentToday}</TableCell>
                    <TableCell>{account.waveMessagesSent}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {account.cooldownUntil
                        ? format(account.cooldownUntil, "dd MMM HH:mm", { locale: es })
                        : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {account.proxyHost
                        ? `${account.proxyHost}:${account.proxyPort ?? "?"}`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      {account.status === AccountStatus.PENDING_CREDENTIALS ? (
                        <Button size="sm" variant="secondary" onClick={() => activateAccount(account.id)}>
                          Activar
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </main>
    </div>
  )
}

export default function AccountsSettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full w-full flex-col">
          <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/5 px-4">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="md:hidden" />
              <h1 className="text-sm font-medium">Cuentas de prospección</h1>
            </div>
          </header>
          <main className="flex-1 overflow-auto p-6">
            <p className="text-sm text-muted-foreground">Cargando...</p>
          </main>
        </div>
      }
    >
      <AccountsSettingsContent />
    </Suspense>
  )
}
