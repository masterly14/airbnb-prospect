export class HarvestMutexBusyError extends Error {
  constructor() {
    super('Playwright mutex busy (IS_PLAYWRIGHT_RUNNING=true)')
    this.name = 'HarvestMutexBusyError'
  }
}

export class HarvestSessionExpiredError extends Error {
  constructor() {
    super('Airbnb session expired. Run: npm run auth:login')
    this.name = 'HarvestSessionExpiredError'
  }
}

export class HarvestAuthMissingError extends Error {
  constructor() {
    super('No auth session found. Run: npm run auth:login')
    this.name = 'HarvestAuthMissingError'
  }
}

export class HarvestSearchBlockedError extends Error {
  readonly blocker: 'captcha' | 'network'

  constructor(blocker: 'captcha' | 'network', market?: string) {
    super(
      market
        ? `Search blocked (${blocker}) for market ${market}`
        : `Search blocked (${blocker})`,
    )
    this.name = 'HarvestSearchBlockedError'
    this.blocker = blocker
  }
}
