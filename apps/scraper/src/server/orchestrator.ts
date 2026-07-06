import { runHarvest } from '../../scripts/harvest-run'
import { runInbound } from '../../scripts/inbound-run'
import { runOutbound } from '../../scripts/outbound-run'
import { maybeResetDailyMessageCounts } from '../../scripts/account-reaper'
import {
  computeNextAvailabilityMs,
  pickNextAccount,
  reactivateExpiredCooldowns,
} from '../accounts/account-selector'
import { mvpModeLogContext } from '../accounts/mvp-mode'
import {
  countColdPipeline,
  hasEligibleOutboundLeads,
} from '../persistence/outbound-pipeline'
import { findLeadsForInboundPoll } from '../persistence/inbound-pipeline'
import { releasePlaywrightMutex } from '../persistence/system-state'

export type OrchestratorConfig = {
  enabled: boolean
  /** Sueño mínimo entre ciclos (evita busy-loop). */
  minSleepMs: number
  /** Tope de sueño aunque el próximo desbloqueo sea más lejano (re-chequeo periódico). */
  maxSleepMs: number
  /** Sueño cuando hubo trabajo y quedan cosas por hacer pronto. */
  activePauseMs: number
  /** Sueño cuando no hay cuentas usables en absoluto (todas bloqueadas/sin sesión). */
  noAccountsSleepMs: number
  /** Backoff tras un error de ciclo. */
  errorBackoffMs: number
  /** Umbral de leads fríos en cola por debajo del cual se dispara harvest. */
  harvestPipelineMin: number
  /**
   * Cadencia máxima de revisión de la bandeja de entrada. Aunque todas las
   * cuentas estén en cooldown para conversaciones nuevas, el daemon despierta
   * al menos cada `inboundPollMs` para responder hilos existentes (respuestas
   * en minutos, no en horas).
   */
  inboundPollMs: number
}

export function resolveOrchestratorConfig(
  env: NodeJS.ProcessEnv = process.env,
): OrchestratorConfig {
  const int = (key: string, fallback: number): number => {
    const parsed = Number.parseInt(env[key] ?? '', 10)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
  }

  return {
    enabled: env.ORCHESTRATOR_ENABLED !== 'false',
    minSleepMs: int('ORCHESTRATOR_MIN_SLEEP_MS', 15_000),
    maxSleepMs: int('ORCHESTRATOR_MAX_SLEEP_MS', 6 * 60 * 60 * 1_000),
    activePauseMs: int('ORCHESTRATOR_ACTIVE_PAUSE_MS', 30_000),
    noAccountsSleepMs: int('ORCHESTRATOR_NO_ACCOUNTS_SLEEP_MS', 5 * 60 * 1_000),
    errorBackoffMs: int('ORCHESTRATOR_ERROR_BACKOFF_MS', 60_000),
    harvestPipelineMin: int('HARVEST_PIPELINE_MIN', 40),
    inboundPollMs: int('ORCHESTRATOR_INBOUND_POLL_MS', 5 * 60 * 1_000),
  }
}

/**
 * Cuánto dormir cuando NO hay cuenta disponible ahora:
 * - `waitMs === 0`  → una cuenta ya está lista; dormir el mínimo y reintentar.
 * - `waitMs > 0`    → dormir hasta el próximo desbloqueo (acotado por min/max).
 * - `waitMs === null` → no hay cuentas usables; dormir el fallback largo.
 */
export function resolveIdleSleepMs(
  waitMs: number | null,
  config: OrchestratorConfig,
): number {
  if (waitMs === null) return config.noAccountsSleepMs
  if (waitMs <= 0) return config.minSleepMs
  return Math.min(config.maxSleepMs, Math.max(config.minSleepMs, waitMs))
}

function orchestratorLog(event: string, data: Record<string, unknown> = {}): void {
  console.log(
    JSON.stringify({ ts: new Date().toISOString(), event, ...mvpModeLogContext(), ...data }),
  )
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      resolve()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export type CycleResult = {
  action: 'idle' | 'worked' | 'noop'
  sleepMs: number
  did?: { inbound: boolean; outbound: boolean; harvest: boolean }
  waitMs?: number | null
}

/**
 * Un ciclo del orquestador. Prioridad: inbound (respuestas) → outbound (envíos)
 * → harvest (descubrir) si el pipeline está bajo. No lanza: los sub-jobs
 * gestionan sus propios bloqueos/rotación/cooldown.
 *
 * Clave: inbound corre SIEMPRE, aunque no exista ninguna cuenta apta para
 * iniciar conversaciones nuevas. Un bloqueo/cooldown de Airbnb solo limita el
 * contacto en frío; responder dentro de un hilo existente nunca se bloquea, y
 * un lead caliente debe recibir respuesta en minutos, no en horas.
 */
export async function runOrchestratorCycle(
  config: OrchestratorConfig,
): Promise<CycleResult> {
  await maybeResetDailyMessageCounts()
  await reactivateExpiredCooldowns()

  const did = { inbound: false, outbound: false, harvest: false }

  // 1) INBOUND — independiente de bloqueos de envío.
  const inboundLeads = await findLeadsForInboundPoll(1)
  if (inboundLeads.length > 0) {
    await runInbound({ writeReport: false, disconnectDb: false })
    did.inbound = true
  }

  // 2) ENVÍOS — solo si hay una cuenta apta para conversaciones nuevas.
  const account = await pickNextAccount()
  if (account) {
    if (await hasEligibleOutboundLeads()) {
      await runOutbound({ writeReport: false, disconnectDb: false })
      did.outbound = true
    }

    const coldPipeline = await countColdPipeline()
    if (coldPipeline < config.harvestPipelineMin) {
      await runHarvest({ writeReport: false, disconnectDb: false })
      did.harvest = true
    }

    const worked = did.inbound || did.outbound || did.harvest
    return {
      action: worked ? 'worked' : 'noop',
      sleepMs: worked ? config.activePauseMs : config.minSleepMs,
      did,
    }
  }

  // 3) Sin cuenta para enviar (todas en cooldown/tope diario): seguir revisando
  //    la bandeja con cadencia rápida. Dormir el menor entre el poll de inbound
  //    y el próximo desbloqueo de envíos, para no dejar enfriar respuestas.
  const waitMs = await computeNextAvailabilityMs()
  const sleepMs = Math.min(config.inboundPollMs, resolveIdleSleepMs(waitMs, config))
  return { action: did.inbound ? 'worked' : 'idle', sleepMs, did, waitMs }
}

/**
 * Daemon autónomo: corre indefinidamente sin depender de crons externos. El
 * ritmo lo marcan los bloqueos/desbloqueos de Airbnb (cooldowns en Neon).
 */
export async function runOrchestrator(signal?: AbortSignal): Promise<void> {
  const config = resolveOrchestratorConfig()
  orchestratorLog('orchestrator.start', {
    enabled: config.enabled,
    harvestPipelineMin: config.harvestPipelineMin,
    maxSleepMs: config.maxSleepMs,
  })

  // El daemon es el único dueño de Playwright: limpiar mutex colgado tras un
  // reinicio/crash previo para no autobloquearse.
  await releasePlaywrightMutex().catch(() => {})

  while (!signal?.aborted) {
    if (!config.enabled) {
      orchestratorLog('orchestrator.disabled')
      await sleep(config.noAccountsSleepMs, signal)
      continue
    }

    try {
      const result = await runOrchestratorCycle(config)
      orchestratorLog('orchestrator.cycle', {
        action: result.action,
        sleepMs: result.sleepMs,
        did: result.did,
        waitMs: result.waitMs,
      })
      await sleep(result.sleepMs, signal)
    } catch (error) {
      await releasePlaywrightMutex().catch(() => {})
      orchestratorLog('orchestrator.cycle_error', {
        error: error instanceof Error ? error.message : String(error),
      })
      await sleep(config.errorBackoffMs, signal)
    }
  }

  orchestratorLog('orchestrator.stopped')
}
