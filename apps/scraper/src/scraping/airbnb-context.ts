import type { BrowserContextOptions } from 'playwright'

/** Medellín — alinea locale/región con una sesión típica en Colombia. */
export const COLOMBIA_GEO = {
  latitude: 6.25184,
  longitude: -75.56359,
}

export function getAirbnbBaseUrl(): string {
  return process.env.AIRBNB_BASE_URL ?? 'https://www.airbnb.com.co'
}

export function getColombiaContextOptions(): BrowserContextOptions {
  const locale = process.env.AIRBNB_LOCALE ?? 'es-CO'

  return {
    locale,
    timezoneId: process.env.AIRBNB_TIMEZONE ?? 'America/Bogota',
    geolocation: COLOMBIA_GEO,
    permissions: ['geolocation'],
    extraHTTPHeaders: {
      'Accept-Language': `${locale},es;q=0.9,en;q=0.8`,
    },
  }
}

export function getChromeChannelOption(): { channel?: 'chrome' } {
  return process.env.AIRBNB_BROWSER === 'chrome' ? { channel: 'chrome' } : {}
}
