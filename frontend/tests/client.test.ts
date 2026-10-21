import assert from 'node:assert/strict'
import { afterEach, beforeEach, mock, test } from 'node:test'
import { api, ApiError } from '../src/services/client'
import { getSession, setSession } from '../src/services/session'
import type { TokenPair } from '../src/types'

const initial: TokenPair = {
  access_token: 'expired',
  refresh_token: 'first',
  token_type: 'bearer',
  expires_in: 900,
  refresh_expires_in: 3600,
}
const replacement: TokenPair = { ...initial, access_token: 'renewed', refresh_token: 'second' }
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  const storage = new Map<string, string>()
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() })
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  })
  setSession(initial)
})
afterEach(() => mock.restoreAll())

test('concurrent expired requests rotate once and all retry with the replacement token', async () => {
  let refreshes = 0
  mock.method(globalThis, 'fetch', async (input: string | URL | Request, options?: RequestInit) => {
    if (String(input).endsWith('/auth/refresh')) {
      refreshes += 1
      await new Promise((resolve) => setTimeout(resolve, 10))
      return json(replacement)
    }
    return new Headers(options?.headers).get('Authorization') === 'Bearer renewed'
      ? json({ ok: true })
      : json({ detail: 'Expired' }, 401)
  })
  const results = await Promise.all([api('/buildings'), api('/users'), api('/floors')])
  assert.deepEqual(results, [{ ok: true }, { ok: true }, { ok: true }])
  assert.equal(refreshes, 1)
  assert.equal(getSession()?.refresh_token, 'second')
})

test('a transient refresh outage preserves credentials for a later retry', async () => {
  mock.method(globalThis, 'fetch', async (input: string | URL | Request) =>
    String(input).endsWith('/auth/refresh')
      ? json({ detail: 'Try later' }, 503)
      : json({ detail: 'Expired' }, 401),
  )
  await assert.rejects(
    api('/buildings'),
    (error: unknown) => error instanceof ApiError && error.status === 503,
  )
  assert.equal(getSession()?.refresh_token, 'first')
})

test('rejected refresh credentials clear the login', async () => {
  mock.method(globalThis, 'fetch', async () => json({ detail: 'Expired' }, 401))
  await assert.rejects(
    api('/buildings'),
    (error: unknown) => error instanceof ApiError && error.status === 401,
  )
  assert.equal(getSession(), null)
})
