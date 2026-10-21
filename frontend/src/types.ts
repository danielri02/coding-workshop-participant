/** Public account fields returned by the API; credentials are never included. */
export interface User {
  id: number
  name: string
  email: string
  is_admin: boolean
  engineer_profile: { user_id: number; is_available: boolean } | null
}

/** Token pair persisted for the current browser tab. */
export interface TokenPair {
  access_token: string
  refresh_token: string
  token_type: 'bearer'
  expires_in: number
  refresh_expires_in: number
}

/** Shared record shape used by configurable grids and forms. */
export interface AdminRow {
  id: number
  [field: string]: unknown
}

/** A referenced record used by select inputs and readable grid labels. */
export interface Option {
  value: string | number
  label: string
}

export type FormValue = string | number | boolean
export type FormValues = Record<string, FormValue>
export type ResourceKey =
  'users' | 'engineers' | 'buildings' | 'floors' | 'seats' | 'incidents' | 'notes'

/** Data used to label relationships without putting IDs into user-facing forms. */
export interface Lookups {
  users: AdminRow[]
  engineers: AdminRow[]
  buildings: AdminRow[]
  floors: AdminRow[]
  seats: AdminRow[]
}

/** Server-side incident page with a filtered total. */
export interface IncidentPage {
  rows: AdminRow[]
  row_count: number
  page: number
  page_size: number
}
