import { createHmac, timingSafeEqual } from 'node:crypto'

export function verifyCalComSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret = process.env.CALCOM_WEBHOOK_SECRET,
): boolean {
  if (!secret || !signatureHeader) return false

  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')

  try {
    const expectedBuffer = Buffer.from(expected, 'utf8')
    const receivedBuffer = Buffer.from(signatureHeader, 'utf8')
    if (expectedBuffer.length !== receivedBuffer.length) return false
    return timingSafeEqual(expectedBuffer, receivedBuffer)
  } catch {
    return false
  }
}
