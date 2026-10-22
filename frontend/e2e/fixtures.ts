import { mkdirSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { test as base, expect } from '@playwright/test'

declare global {
  interface Window {
    __coverage__?: object
    collectCoverage?: (coverage: string) => Promise<void>
  }
}

/** Save coverage before reload/navigation and again before each browser context closes. */
export const test = base.extend({
  context: async ({ context }, run) => {
    if (process.env.E2E_COVERAGE !== '1') {
      await run(context)
      return
    }
    mkdirSync('coverage/browser', { recursive: true })
    await context.exposeFunction('collectCoverage', (coverage: string) => {
      writeFileSync(`coverage/browser/${randomUUID()}.json`, coverage)
    })
    await context.addInitScript(() => {
      window.addEventListener('beforeunload', () => {
        if (window.__coverage__) void window.collectCoverage?.(JSON.stringify(window.__coverage__))
      })
    })
    await run(context)
    for (const page of context.pages())
      if (!page.isClosed())
        await page.evaluate(async () => {
          if (window.__coverage__)
            await window.collectCoverage?.(JSON.stringify(window.__coverage__))
        })
  },
})

export { expect }
