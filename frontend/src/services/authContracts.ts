import type { TokenPair, User } from '../types'

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/** Reject unrelated successful responses before persisting a login or refresh. */
export function isTokenPair(value: unknown): value is TokenPair {
  return (
    isObject(value) &&
    typeof value.access_token === 'string' &&
    value.access_token.length > 0 &&
    typeof value.refresh_token === 'string' &&
    value.refresh_token.length > 0 &&
    value.token_type === 'bearer' &&
    isPositiveNumber(value.expires_in) &&
    isPositiveNumber(value.refresh_expires_in)
  )
}

/** A missing role field is a contract error; only an explicit false denies admin access. */
export function isUser(value: unknown): value is User {
  if (!isObject(value)) return false
  const profile = value.engineer_profile
  return (
    isPositiveNumber(value.id) &&
    Number.isInteger(value.id) &&
    typeof value.name === 'string' &&
    typeof value.email === 'string' &&
    typeof value.is_admin === 'boolean' &&
    (profile == null ||
      (isObject(profile) &&
        isPositiveNumber(profile.user_id) &&
        Number.isInteger(profile.user_id) &&
        typeof profile.is_available === 'boolean'))
  )
}
