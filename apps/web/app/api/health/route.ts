import { NextResponse } from "next/server"
import { AccountStatus, LeadStatus, MessageDirection } from "@repo/db"
import { db } from "@/lib/db"
import { OPERATIONS } from "@/lib/operations/constants"
import { getColdQuotaSnapshot } from "@/lib/accounts/quota"
import {
  getMvpAccountId,
  getProspectAccountTarget,
  isMvpSingleAccountMode,
} from "@/lib/operations/mvp-mode"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Health check: conectividad a Neon, estado del mutex Playwright y
 * configuración de la cola (QStash). No requiere auth para poder usarse como
 * probe de infraestructura.
 */
export async function GET() {
  const checks: Record<string, { ok: boolean; detail?: string }> = {}

  try {
    await db.$queryRaw`SELECT 1`
    checks.database = { ok: true }
  } catch (error) {
    checks.database = {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    }
  }

  try {
    const mutex = await db.systemState.findUnique({
      where: { key: "IS_PLAYWRIGHT_RUNNING" },
    })
    const activeAccount = await db.systemState.findUnique({
      where: { key: "PLAYWRIGHT_ACTIVE_ACCOUNT" },
    })
    checks.playwrightMutex = {
      ok: true,
      detail: mutex?.value === "true" ? "running" : "idle",
    }
    if (activeAccount?.value) {
      checks.playwrightActiveAccount = { ok: true, detail: activeAccount.value }
    }
  } catch (error) {
    checks.playwrightMutex = {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    }
  }

  let accountCounts = { active: 0, cooldown: 0, blocked: 0 }
  try {
    const [active, cooldown, blocked] = await Promise.all([
      db.prospectAccount.count({ where: { status: AccountStatus.ACTIVE } }),
      db.prospectAccount.count({ where: { status: AccountStatus.COOLDOWN } }),
      db.prospectAccount.count({ where: { status: AccountStatus.BLOCKED } }),
    ])
    accountCounts = { active, cooldown, blocked }
    checks.accounts = {
      ok: true,
      detail: `active=${active} cooldown=${cooldown} blocked=${blocked}`,
    }
  } catch (error) {
    checks.accounts = {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    }
  }

  try {
    const quotas = await getColdQuotaSnapshot()
    checks.cityQuotas = {
      ok: true,
      detail: Object.entries(quotas)
        .map(([market, { sent, quota }]) => `${market}:${sent}/${quota}`)
        .join(" "),
    }
  } catch (error) {
    checks.cityQuotas = {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    }
  }

  try {
    const [hostContactsTotal, leadsDiscoveredWithOutbound] = await Promise.all([
      db.hostContact.count(),
      db.lead.count({
        where: {
          status: LeadStatus.LEAD_DISCOVERED,
          OR: [
            { threadId: { not: null } },
            { messages: { some: { direction: MessageDirection.OUTBOUND } } },
            { hostContact: { isNot: null } },
          ],
        },
      }),
    ])
    checks.contactDedup = {
      ok: leadsDiscoveredWithOutbound === 0,
      detail: `hostContacts=${hostContactsTotal} inconsistentDiscovered=${leadsDiscoveredWithOutbound}`,
    }
  } catch (error) {
    checks.contactDedup = {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    }
  }

  const mvpAccountId = getMvpAccountId()
  if (isMvpSingleAccountMode() && mvpAccountId) {
    try {
      const mvpAccount = await db.prospectAccount.findUnique({
        where: { id: mvpAccountId },
        select: { id: true, label: true, status: true, market: true, messagesSentToday: true },
      })
      checks.mvpMode = {
        ok: Boolean(mvpAccount),
        detail: mvpAccount
          ? `${mvpAccount.label} (${mvpAccount.id}) status=${mvpAccount.status} market=${mvpAccount.market ?? "unset"} msgsToday=${mvpAccount.messagesSentToday}`
          : `account ${mvpAccountId} not found`,
      }
    } catch (error) {
      checks.mvpMode = {
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      }
    }
  } else {
    checks.mvpMode = { ok: true, detail: "disabled (multi-account)" }
  }

  const queueConfigured = Boolean(
    process.env.QSTASH_CURRENT_SIGNING_KEY ||
      process.env.QSTASH_NEXT_SIGNING_KEY ||
      process.env.CRON_SECRET,
  )
  checks.queue = {
    ok: queueConfigured,
    detail: queueConfigured ? "configured" : "missing CRON_SECRET/QSTASH keys",
  }

  checks.operations = {
    ok: true,
    detail: `${getProspectAccountTarget()} account(s) × ${OPERATIONS.MSGS_PER_WAVE} msgs/wave × ${OPERATIONS.WAVES_PER_DAY_TARGET} waves/day`,
  }

  const healthy = Object.values(checks).every((c) => c.ok)

  return NextResponse.json(
    {
      ok: healthy,
      checks,
      metrics: {
        mvpMode: isMvpSingleAccountMode(),
        mvpAccountId: mvpAccountId ?? undefined,
        accountsActive: accountCounts.active,
        accountsCooldown: accountCounts.cooldown,
        accountsBlocked: accountCounts.blocked,
        hostContactsTotal: checks.contactDedup?.ok
          ? Number.parseInt(checks.contactDedup.detail?.match(/hostContacts=(\d+)/)?.[1] ?? "0", 10)
          : undefined,
        leadsDiscoveredWithOutbound: checks.contactDedup?.ok
          ? Number.parseInt(
              checks.contactDedup.detail?.match(/inconsistentDiscovered=(\d+)/)?.[1] ?? "0",
              10,
            )
          : undefined,
      },
      timestamp: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503 },
  )
}
