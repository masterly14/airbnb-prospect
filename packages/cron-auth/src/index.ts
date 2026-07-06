import { Receiver } from '@upstash/qstash'

export type CronAuthResult = {
  authorized: boolean
  source: 'cron_secret' | 'qstash' | 'none'
}

function getBearerToken(authorization: string | null): string | null {
  if (!authorization?.startsWith('Bearer ')) return null
  return authorization.slice(7).trim()
}

export async function verifyCronRequest(
  request: Request,
): Promise<CronAuthResult> {
  const cronSecret = process.env.CRON_SECRET
  const bearer = getBearerToken(request.headers.get('authorization'))

  if (cronSecret && bearer === cronSecret) {
    return { authorized: true, source: 'cron_secret' }
  }

  const currentKey = process.env.QSTASH_CURRENT_SIGNING_KEY
  const nextKey = process.env.QSTASH_NEXT_SIGNING_KEY

  if (currentKey || nextKey) {
    const receiver = new Receiver({
      currentSigningKey: currentKey ?? '',
      nextSigningKey: nextKey ?? '',
    })

    const signature = request.headers.get('upstash-signature')
    const body = await request.text()

    if (signature) {
      const isValid = await receiver.verify({
        signature,
        body,
        url: request.url,
      })

      if (isValid) {
        return { authorized: true, source: 'qstash' }
      }
    }
  }

  return { authorized: false, source: 'none' }
}

export async function forwardToWorker(
  workerUrl: string,
  cronSecret?: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (cronSecret) {
    headers.Authorization = `Bearer ${cronSecret}`
  }

  return fetch(workerUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ triggeredAt: new Date().toISOString() }),
  })
}
