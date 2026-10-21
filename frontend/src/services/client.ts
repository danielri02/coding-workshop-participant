import type { TokenPair } from '../types'
import { getSession, setSession } from './session'

const apiUrl = (import.meta.env?.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '')
let refreshInFlight: Promise<TokenPair> | null = null

/** A safe HTTP failure, with validation messages mapped to form fields. */
export class ApiError extends Error {
  status: number
  fields: Record<string, string>

  constructor(message: string, status: number, fields: Record<string, string> = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.fields = fields
  }
}

/** Explain API, network and unknown failures without displaying raw HTML. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.'
}

async function readResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T
  const body: unknown = await response.json().catch(() => null)
  if (response.ok) return body as T
  let message =
    response.status >= 500
      ? 'The server could not complete this request. Please try again.'
      : `Request failed (${response.status}).`
  const fields: Record<string, string> = {}
  if (body && typeof body === 'object' && 'detail' in body) {
    if (typeof body.detail === 'string') message = body.detail
    else if (Array.isArray(body.detail)) {
      for (const issue of body.detail) {
        if (issue && typeof issue === 'object' && typeof issue.msg === 'string') {
          const name = Array.isArray(issue.loc) ? String(issue.loc.at(-1)) : ''
          fields[name] = issue.msg.replace(/^Value error, /, '')
        }
      }
      message = Object.values(fields).join('. ') || 'Please check the form values.'
    }
  }
  throw new ApiError(message, response.status, fields)
}

async function send(path: string, options: RequestInit, token?: string): Promise<Response> {
  const headers = new Headers(options.headers)
  if (options.body) headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)
  try {
    return await fetch(`${apiUrl}${path}`, { ...options, headers })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError('Cannot reach the API. Check that the backend is running and try again.', 0)
  }
}

async function refreshSession(): Promise<TokenPair> {
  if (refreshInFlight) return refreshInFlight
  const refreshToken = getSession()?.refresh_token
  if (!refreshToken) throw new ApiError('Your session has expired. Please sign in again.', 401)
  refreshInFlight = (async () => {
    try {
      const tokens = await readResponse<TokenPair>(
        await send('/auth/refresh', {
          method: 'POST',
          body: JSON.stringify({ refresh_token: refreshToken }),
        }),
      )
      if (getSession()?.refresh_token !== refreshToken)
        throw new ApiError('The login session has changed.', 401)
      setSession(tokens)
      return tokens
    } catch (error) {
      // Network/server errors permit retry; rejected credentials end this login.
      if (
        error instanceof ApiError &&
        error.status === 401 &&
        getSession()?.refresh_token === refreshToken
      )
        setSession(null)
      throw error
    } finally {
      refreshInFlight = null
    }
  })()
  return refreshInFlight
}

/** Send JSON with bearer authentication, sharing one refresh across concurrent 401s. */
export async function api<T>(
  path: string,
  options: RequestInit = {},
  authenticated = true,
): Promise<T> {
  let usedToken = authenticated ? getSession()?.access_token : undefined
  let response = await send(path, options, usedToken)
  if (authenticated && response.status === 401 && getSession()) {
    const current = getSession()
    const tokens = current?.access_token !== usedToken ? current : await refreshSession()
    usedToken = tokens?.access_token
    response = await send(path, options, usedToken)
  }
  if (authenticated && response.status === 401 && getSession()?.access_token === usedToken)
    setSession(null)
  return readResponse<T>(response)
}
