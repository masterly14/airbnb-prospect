import dotenv from 'dotenv'
import path from 'path'
import { releasePlaywrightMutex } from '../src/persistence/system-state'
import { db } from '@repo/db'

dotenv.config({ path: path.resolve(__dirname, '../../../.env') })

async function main() {
  await releasePlaywrightMutex()
  console.log('Mutex Playwright liberado (IS_PLAYWRIGHT_RUNNING=false)')
  await db.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
