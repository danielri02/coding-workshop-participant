import type { TokenPair } from '../types'
import { getSession, setSession } from './session'
import { isTokenPair } from './authContracts'
import { apiBaseUrl } from './apiConfig'

const apiUrl = apiBaseUrl(import.meta.env || {}, Boolean(import.meta.env?.DEV))
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

type ResponseValidator<T> = (value: unknown) => value is T

async function readResponse<T>(
  response: Response,
  path: string,
  validate?: ResponseValidator<T>,
): Promise<T> {
  if (response.status === 204 && !validate) return undefined as T
  const body: unknown = await response.json().catch(() => null)
  if (response.ok) {
    if (body === null || typeof body !== 'object' || (validate && !validate(body)))
      throw new ApiError(
        `The configured API returned an unexpected response for ${path}. Check VITE_API_MODE, VITE_API_URL and the workshop-generated API mapping, then restart the frontend.`,
        502,
      )
    return body as T
  }
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
        '/auth/refresh',
        isTokenPair,
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
  validate?: ResponseValidator<T>,
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
  return readResponse<T>(response, path, validate)
}
