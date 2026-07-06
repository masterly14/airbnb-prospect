export type ComposioConfig = {
  apiKey: string
  userId: string
  connectionId: string
  gmailToolkitVersion: string
  timeoutMs: number
  pollMs: number
}

export type ComposioOtpAccount = {
  composioUserId?: string | null
  composioConnectionId?: string | null
}
