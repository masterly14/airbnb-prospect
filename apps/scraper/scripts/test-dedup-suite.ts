/**
 * Suite de pruebas de deduplicación listing ↔ host ↔ hilo.
 *
 * Uso:
 *   npm run test:dedup
 *   npm run test:dedup:ci          # sin browser
 *   npm run test:dedup:production  # auditoría completa pre-deploy
 */
import dotenv from 'dotenv'
import path from 'path'
import { spawnSync } from 'child_process'

dotenv.config({ path: path.resolve(__dirname, '../../../.env'), override: false })

const SCRIPTS_DIR = __dirname
const skipBrowser = process.argv.includes('--skip-browser')
const productionOnly = process.argv.includes('--production')

function runScript(scriptName: string, extraArgs: string[] = []): boolean {
  const scriptPath = path.join(SCRIPTS_DIR, scriptName)
  const result = spawnSync('npx', ['tsx', scriptPath, ...extraArgs], {
    stdio: 'inherit',
    shell: true,
    cwd: path.resolve(__dirname, '../../..'),
  })
  return result.status === 0
}

function runNpm(workspace: string, script: string): boolean {
  const result = spawnSync('npm', ['run', script, '-w', workspace], {
    stdio: 'inherit',
    shell: true,
    cwd: path.resolve(__dirname, '../../..'),
  })
  return result.status === 0
}

async function main() {
  console.log('\n=== Dedup test suite ===\n')

  type Step = { label: string; ok: boolean; group: string }
  const steps: Step[] = []

  const run = (group: string, label: string, script: string, args: string[] = []) => {
    console.log(`\n--- ${group}: ${label} ---`)
    steps.push({ group, label, ok: runScript(script, args) })
  }

  if (!productionOnly) {
    console.log('--- Unit: @repo/lead-contact ---')
    steps.push({ group: 'unit', label: 'lead-contact', ok: runNpm('@repo/lead-contact', 'test') })

    run('integration', 'listing dedup CRM+cluster', 'test-listing-dedup-integration.ts')
    run('integration', 'synthetic harvest gap', 'test-synthetic-harvest-gap.ts')
    run('integration', 'block paths', 'test-dedup-block-paths.ts')
    run('integration', 'negative controls', 'test-dedup-negative-controls.ts')
    run('integration', 'createManualLead guard', 'test-dedup-create-manual.ts')

    run(
      'e2e',
      'Sebastian/Michell listing',
      'test-listing-e2e.ts',
      skipBrowser ? ['--skip-browser'] : [],
    )
    run('smoke', 'CRM lookup by listing', 'test-listing-dedup.ts')
  }

  run('production', 'matrix audit (all HostContact + cold queue)', 'test-dedup-production-matrix.ts')

  console.log('\n=== Resumen ===')
  const groups = [...new Set(steps.map((step) => step.group))]
  for (const group of groups) {
    console.log(`\n[${group}]`)
    for (const step of steps.filter((s) => s.group === group)) {
      console.log(`  [${step.ok ? 'PASS' : 'FAIL'}] ${step.label}`)
    }
  }

  const failed = steps.filter((step) => !step.ok)
  if (failed.length > 0) {
    console.error(`\n${failed.length} paso(s) fallaron.`)
    process.exit(1)
  }

  console.log('\nTodos los pasos pasaron.')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
