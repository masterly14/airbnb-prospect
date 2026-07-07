import dotenv from 'dotenv'
import path from 'path'
import { setHarvestSearchPage } from '../src/persistence/system-state'
import { db } from '@repo/db'

dotenv.config({ path: path.resolve(__dirname, '../../../.env') })

async function main() {
  await setHarvestSearchPage('Bogotá--Colombia', 1)
  console.log('[reset] Bogotá page -> 1')
  await db.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
