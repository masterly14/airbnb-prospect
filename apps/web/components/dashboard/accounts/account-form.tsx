"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AccountMarketSelect } from "@/components/dashboard/accounts/account-market-select"
import { createAccountRequest } from "@/lib/accounts/api-client"
import type { ProspectAccountMarket } from "@/lib/accounts/markets"
import type { ProspectAccountSummary } from "@/lib/accounts/types"

type AccountFormProps = {
  onCreated: (account: ProspectAccountSummary) => void
}

export function AccountForm({ onCreated }: AccountFormProps) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [market, setMarket] = useState<ProspectAccountMarket>("Bogotá")

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    setError(null)
    startTransition(async () => {
      try {
        const proxyPortRaw = formData.get("proxyPort")?.toString().trim()
        const account = await createAccountRequest({
          label: formData.get("label")?.toString() ?? "",
          airbnbEmail: formData.get("airbnbEmail")?.toString() ?? "",
          market,
          password: formData.get("password")?.toString() || undefined,
          proxyHost: formData.get("proxyHost")?.toString() || undefined,
          proxyPort: proxyPortRaw ? Number.parseInt(proxyPortRaw, 10) : undefined,
          proxyUser: formData.get("proxyUser")?.toString() || undefined,
          proxyPass: formData.get("proxyPass")?.toString() || undefined,
          sessionPath: formData.get("sessionPath")?.toString() || undefined,
        })
        onCreated(account)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al crear cuenta")
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-white/5 bg-card/30 p-5 space-y-4">
      <div>
        <h2 className="text-sm font-medium">Alta manual de cuenta</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Credenciales cifradas en servidor. Tras guardar la sesión Playwright, activa la cuenta.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="label">Etiqueta</Label>
          <Input id="label" name="label" placeholder="Cuenta Bogotá #1" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="airbnbEmail">Email Airbnb</Label>
          <Input id="airbnbEmail" name="airbnbEmail" type="email" required />
        </div>
        <div className="space-y-2">
          <Label>Ciudad</Label>
          <AccountMarketSelect value={market} onValueChange={setMarket} disabled={isPending} />
          <p className="text-xs text-muted-foreground">
            Mercado al que esta cuenta enviará mensajes de prospección.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Contraseña Airbnb</Label>
          <Input id="password" name="password" type="password" autoComplete="new-password" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="sessionPath">Ruta sesión (opcional)</Label>
          <Input
            id="sessionPath"
            name="sessionPath"
            placeholder="playwright/.auth/account-xxx.json"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="proxyHost">Proxy host (Decodo)</Label>
          <Input id="proxyHost" name="proxyHost" placeholder="gate.decodo.com" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="proxyPort">Proxy puerto</Label>
          <Input id="proxyPort" name="proxyPort" type="number" placeholder="7000" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="proxyUser">Proxy usuario</Label>
          <Input
            id="proxyUser"
            name="proxyUser"
            placeholder="user-…-country-co-session-…-sessionduration-1440"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="proxyPass">Proxy contraseña</Label>
          <Input id="proxyPass" name="proxyPass" type="password" autoComplete="new-password" />
        </div>
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <Button type="submit" disabled={isPending}>
        {isPending ? "Guardando..." : "Crear cuenta"}
      </Button>
    </form>
  )
}
