export function stripHttps(link: string): string {
  return link.replace(/^https?:\/\//i, '')
}

export function getCalComBaseLink(): string {
  const link = process.env.CAL_COM_LINK ?? 'cal.com/agent-pilot/diagnostico'
  return stripHttps(link)
}

export function buildCalComLinkForLead(leadId: string): string {
  const base = getCalComBaseLink()
  const separator = base.includes('?') ? '&' : '?'
  return `${base}${separator}metadata[leadId]=${encodeURIComponent(leadId)}`
}
