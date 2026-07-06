import { NextResponse } from 'next/server'
import { forwardToWorker, verifyCronRequest } from '@repo/cron-auth'

export async function POST(request: Request) {
  const auth = await verifyCronRequest(request)

  if (!auth.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const workerUrl = process.env.OUTBOUND_WORKER_URL

  if (workerUrl) {
    try {
      const workerResponse = await forwardToWorker(workerUrl, process.env.CRON_SECRET)
      const body = await workerResponse.text()

      return NextResponse.json({
        ok: workerResponse.ok,
        source: auth.source,
        forwarded: true,
        workerStatus: workerResponse.status,
        workerBody: body.slice(0, 500),
      })
    } catch (error) {
      return NextResponse.json(
        {
          ok: false,
          source: auth.source,
          forwarded: false,
          error: error instanceof Error ? error.message : String(error),
        },
        { status: 502 },
      )
    }
  }

  return NextResponse.json({
    ok: true,
    source: auth.source,
    message: 'Cron verified. Run npm run outbound:run on the Playwright worker.',
  })
}
