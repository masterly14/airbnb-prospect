type HarvestLogEvent =
  | 'lead.created'
  | 'lead.updated'
  | 'lead.unchanged'
  | 'lead.skipped'
  | 'harvest.start'
  | 'harvest.market'
  | 'harvest.complete'
  | 'harvest.error'
  | 'enrich.success'
  | 'enrich.failed'

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
