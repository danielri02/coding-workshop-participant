import type { TokenPair } from '../types'

const storageKey = 'acme.admin.session'
export const sessionEvent = 'acme-session-change'

/** Read this tab's login, ignoring invalid or obsolete browser storage. */
export function getSession(): TokenPair | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(storageKey) || 'null')
    if (
      value &&
      typeof value === 'object' &&
      'access_token' in value &&
      'refresh_token' in value &&
      typeof value.access_token === 'string' &&
      typeof value.refresh_token === 'string'
    ) {
      return value as TokenPair
    }
  } catch {
    sessionStorage.removeItem(storageKey)
  }
  return null
}

/** Update the tab's credentials and notify mounted authentication consumers. */
export function setSession(tokens: TokenPair | null): void {
  if (tokens) sessionStorage.setItem(storageKey, JSON.stringify(tokens))
  else sessionStorage.removeItem(storageKey)
  window.dispatchEvent(new Event(sessionEvent))
}
