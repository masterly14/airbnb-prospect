import type { Page } from 'playwright'
import type { Lead } from '@repo/db'
import { collectInboxThreads } from './airbnb-inbox'

export function extractThreadUrl(pageUrl: string): string | null {
  const match = pageUrl.match(/(https?:\/\/[^/]+\/guest\/messages\/[^\s?#/]+)/i)
  return match?.[1] ?? null
}

export async function findExistingThreadForLead(page: Page, lead: Lead): Promise<string | null> {
  const fromUrl = extractThreadUrl(page.url())
  if (fromUrl) return fromUrl

  const threads = await collectInboxThreads(page, 50)
  const hostFirst = lead.name.split(' ')[0]?.toLowerCase() ?? ''
  const snippet = lead.primaryListingName?.slice(0, 24).toLowerCase() ?? ''
  const listingMatch = lead.primaryListingUrl.match(/\/rooms\/(\d+)/)
  const listingId = listingMatch?.[1]

  for (const thread of threads) {
    if (listingId && thread.rawText.includes(listingId)) return thread.url
  }

  for (const thread of threads) {
    const nameLower = thread.hostName.toLowerCase()
    if (hostFirst && nameLower.includes(hostFirst)) return thread.url
    if (snippet && thread.rawText.toLowerCase().includes(snippet)) return thread.url
  }

  return null
}
