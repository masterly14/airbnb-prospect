import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import { db } from '@repo/db'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../../../.env') })

async function main() {
  await db.$queryRaw`SELECT 1`
  console.log('@repo/db connected successfully')
  await db.$disconnect()
}

main().catch((error) => {
  console.error('db-smoke failed:', error)
  process.exit(1)
})
