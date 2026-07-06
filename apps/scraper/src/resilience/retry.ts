export type RetryOptions = {
  maxAttempts: number
  baseDelayMs: number
  retryOn?: (error: unknown) => boolean
}

function defaultRetryOn(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase()
    return (
      message.includes('timeout') ||
      message.includes('net::') ||
      message.includes('navigation') ||
      message.includes('target closed')
    )
  }
  return false
}

export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const retryOn = options.retryOn ?? defaultRetryOn
  let lastError: unknown

  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (attempt >= options.maxAttempts || !retryOn(error)) {
        throw error
      }
      await sleep(options.baseDelayMs * attempt)
    }
  }

  throw lastError
}
