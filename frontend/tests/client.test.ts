import assert from 'node:assert/strict'
import { afterEach, beforeEach, vi, test } from 'vitest'
import { api, ApiError } from '../src/services/client'
import { getSession, setSession } from '../src/services/session'
import { isTokenPair, isUser } from '../src/services/authContracts'
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
afterEach(() => vi.restoreAllMocks())

test('concurrent expired requests rotate once and all retry with the replacement token', async () => {
  let refreshes = 0
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    async (input: string | URL | Request, options?: RequestInit) => {
      if (String(input).endsWith('/auth/refresh')) {
        refreshes += 1
        await new Promise((resolve) => setTimeout(resolve, 10))
        return json(replacement)
      }
      return new Headers(options?.headers).get('Authorization') === 'Bearer renewed'
        ? json({ ok: true })
        : json({ detail: 'Expired' }, 401)
    },
  )
  const results = await Promise.all([api('/buildings'), api('/users'), api('/floors')])
  assert.deepEqual(results, [{ ok: true }, { ok: true }, { ok: true }])
  assert.equal(refreshes, 1)
  assert.equal(getSession()?.refresh_token, 'second')
})

test('a transient refresh outage preserves credentials for a later retry', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: string | URL | Request) =>
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
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json({ detail: 'Expired' }, 401))
  await assert.rejects(
    api('/buildings'),
    (error: unknown) => error instanceof ApiError && error.status === 401,
  )
  assert.equal(getSession(), null)
})

test('unrelated proxy JSON cannot be accepted as a login token pair', async () => {
  setSession(null)
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    json({ message: 'Development CORS Proxy Server' }),
  )
  await assert.rejects(
    api('/auth/login', { method: 'POST', body: '{}' }, false, isTokenPair),
    (error: unknown) =>
      error instanceof ApiError && error.status === 502 && error.message.includes('VITE_API_URL'),
  )
  assert.equal(getSession(), null)
})

test('a successful HTML fallback explains the API configuration problem', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    async () =>
      new Response('<html>Frontend</html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
  )
  await assert.rejects(
    api('/auth/me'),
    (error: unknown) =>
      error instanceof ApiError && error.message.includes('unexpected response for /auth/me'),
  )
})

test('missing or malformed account roles are rejected, while an explicit non-admin role is valid', async () => {
  const account = {
    id: 1,
    name: 'Employee',
    email: 'employee@acme.inc',
    is_admin: false,
    engineer_profile: null,
  }
  assert.equal(isUser(account), true)
  assert.equal(isUser({ ...account, is_admin: true }), true)
  assert.equal(isUser({ ...account, is_admin: 'false' }), false)
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json({ message: 'Proxy status' }))
  await assert.rejects(
    api('/auth/me', {}, true, isUser),
    (error: unknown) => error instanceof ApiError && error.status === 502,
  )
})

test('an invalid refresh response cannot replace the existing credentials', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: string | URL | Request) =>
    String(input).endsWith('/auth/refresh')
      ? json({ message: 'Proxy status' })
      : json({ detail: 'Expired' }, 401),
  )
  await assert.rejects(
    api('/buildings'),
    (error: unknown) => error instanceof ApiError && error.status === 502,
  )
  assert.equal(getSession()?.refresh_token, 'first')
})
