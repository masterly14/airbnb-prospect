import { z } from 'zod'
import { completeJson } from '../client.js'

export const profilerOutputSchema = z.object({
  businessScale: z.string().min(10),
  painPoints: z.string().min(10),
  executiveSummary: z.string().min(10),
})

export type ProfilerOutput = z.infer<typeof profilerOutputSchema>

export type ProfilerInput = {
  name: string
  totalProperties: number
  companyName?: string | null
  primaryListingName?: string | null
  listingDescription?: string
  listingAmenities?: string[]
  hostBioSnippet?: string
  reviewSnippets?: string[]
}

const SYSTEM_PROMPT = `Eres el Agente Perfilador de Agent Pilot, un asistente de prospección para administradores de rentas cortas en Airbnb.

Tu tarea es analizar la información disponible del anfitrión y devolver un JSON con exactamente estas claves:
- businessScale: 1-2 frases sobre la escala operativa (número de propiedades, tipo de operador, zona si se infiere).
- painPoints: dolores operativos inferidos de reseñas, descripción o contexto (limpieza, respuesta lenta, coordinación, etc.). Si no hay señales claras, indica hipótesis razonables para operadores de ese volumen.
- executiveSummary: resumen ejecutivo de 2-3 frases para un dashboard interno de ventas.

Responde SOLO con JSON válido, en español, sin markdown.`

function buildUserPrompt(input: ProfilerInput): string {
  const parts = [
    `Nombre: ${input.name}`,
    `Propiedades administradas: ${input.totalProperties}`,
  ]

  if (input.companyName) parts.push(`Empresa/Agencia: ${input.companyName}`)
  if (input.primaryListingName) parts.push(`Listing de referencia: ${input.primaryListingName}`)
  if (input.listingDescription) parts.push(`Descripción del anuncio:\n${input.listingDescription}`)
  if (input.listingAmenities?.length) {
    parts.push(`Amenities: ${input.listingAmenities.join(', ')}`)
  }
  if (input.hostBioSnippet) parts.push(`Bio del host:\n${input.hostBioSnippet}`)
  if (input.reviewSnippets?.length) {
    parts.push(`Reseñas recientes:\n${input.reviewSnippets.map((r, i) => `${i + 1}. ${r}`).join('\n')}`)
  }

  return parts.join('\n\n')
}

export async function runProfiler(input: ProfilerInput): Promise<ProfilerOutput> {
  return completeJson(SYSTEM_PROMPT, buildUserPrompt(input), profilerOutputSchema)
}
