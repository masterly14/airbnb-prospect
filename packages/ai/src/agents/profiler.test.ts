import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { profilerOutputSchema } from './profiler.js'

describe('profilerOutputSchema', () => {
  it('validates correct profiler output', () => {
    const output = {
      businessScale: 'Operador con 5 propiedades en zona turística de Medellín.',
      painPoints: 'Reseñas mencionan demoras en la respuesta nocturna y coordinación de limpieza.',
      executiveSummary:
        'Anfitrion multi-propiedad ideal para Agent Pilot. Volumen suficiente para ROI en automatización operativa.',
    }

    const result = profilerOutputSchema.parse(output)
    assert.equal(result.businessScale, output.businessScale)
  })

  it('rejects short fields', () => {
    assert.throws(() =>
      profilerOutputSchema.parse({
        businessScale: 'corto',
        painPoints: 'corto',
        executiveSummary: 'corto',
      }),
    )
  })
})
