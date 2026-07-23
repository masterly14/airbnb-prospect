type KnownHarvestLogEvent =
  | 'lead.created'
  | 'lead.updated'
  | 'lead.unchanged'
  | 'lead.skipped'
  | 'harvest.start'
  | 'harvest.market'
  | 'harvest.complete'
  | 'harvest.error'
  | 'harvest.blocked'
  | 'harvest.page_scraped'
  | 'harvest.page_summary'
  | 'harvest.listing.start'
  | 'harvest.listing.host'
  | 'harvest.listing.detail'
  | 'harvest.listing.icp'
  | 'harvest.listing.bind'
  | 'harvest.send.start'
  | 'harvest.send.success'
  | 'harvest.send.failed'
  | 'harvest.send.skipped'
  | 'harvest.send.blocked'
  | 'harvest.send.cap_reached'
  | 'harvest.send.done_stop_pages'
  | 'harvest.send.listing_mismatch'
  | 'enrich.success'
  | 'enrich.failed'

// Se permite cualquier string para no romper el runtime con eventos nuevos.
type HarvestLogEvent = KnownHarvestLogEvent | (string & {})

export function isHarvestDebugEnabled(): boolean {
  return (
    process.env.HARVEST_DEBUG === 'true' ||
    process.env.HARVEST_TRACE === 'true' ||
    process.env.DEBUG_HARVEST === 'true'
  )
}

export function harvestLog(
  event: HarvestLogEvent,
  data: Record<string, unknown> = {},
): void {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      event,
      ...data,
    }),
  )
}

/** Logs verbosos solo con HARVEST_DEBUG / HARVEST_TRACE. */
export function harvestTrace(
  event: string,
  data: Record<string, unknown> = {},
): void {
  if (!isHarvestDebugEnabled()) return
  harvestLog(`trace.${event}`, data)
}

export function parseListingIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null
  const match = url.match(/\/rooms\/(\d+)/)
  return match?.[1] ?? null
}

export function parseContactHostListingId(url: string | null | undefined): string | null {
  if (!url) return null
  const match = url.match(/\/contact_host\/(\d+)/)
  return match?.[1] ?? null
}
