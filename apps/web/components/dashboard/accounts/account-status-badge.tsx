import { AccountStatus } from "@repo/db/client"
import { Badge } from "@/components/ui/badge"

const STATUS_LABELS: Record<AccountStatus, string> = {
  ACTIVE: "Activa",
  COOLDOWN: "Cooldown",
  BLOCKED: "Bloqueada",
  PENDING_CREDENTIALS: "Pendiente sesión",
  PENDING_GMAIL: "Pendiente Gmail",
  VERIFYING: "Verificando",
}

const STATUS_CLASSES: Record<AccountStatus, string> = {
  ACTIVE: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  COOLDOWN: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  BLOCKED: "border-red-500/30 bg-red-500/10 text-red-400",
  PENDING_CREDENTIALS: "border-sky-500/30 bg-sky-500/10 text-sky-400",
  PENDING_GMAIL: "border-violet-500/30 bg-violet-500/10 text-violet-400",
  VERIFYING: "border-orange-500/30 bg-orange-500/10 text-orange-400",
}

export function AccountStatusBadge({ status }: { status: AccountStatus }) {
  return (
    <Badge variant="outline" className={STATUS_CLASSES[status]}>
      {STATUS_LABELS[status]}
    </Badge>
  )
}
