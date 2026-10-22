import type { components } from './generated/api'

/** Transport contracts generated from FastAPI; never hand-maintain response fields. */
export type ApiSchemas = components['schemas']
export type User = ApiSchemas['UserRead']
export type EngineerProfile = ApiSchemas['EngineerProfileRead']
export type Building = ApiSchemas['BuildingRead']
export type Floor = ApiSchemas['FloorRead']
export type Seat = ApiSchemas['SeatRead']
export type Incident = ApiSchemas['IncidentRead']
export type Note = ApiSchemas['NoteRead']
export type TokenPair = ApiSchemas['TokenPair']
export type DeletionPreview = ApiSchemas['DeletionPreview']
export type IncidentPage = ApiSchemas['IncidentPage']
export type IncidentStatus = ApiSchemas['IncidentStatus']

/** Associate each resource with its actual API response, before grid normalization. */
export interface ResourceRecords {
  users: User
  engineers: EngineerProfile
  buildings: Building
  floors: Floor
  seats: Seat
  incidents: Incident
  notes: Note
}
export type ResourceKey = keyof ResourceRecords
export type ApiRecord = ResourceRecords[ResourceKey]
export type ResourcePageData = Omit<IncidentPage, 'rows'> & { rows: ApiRecord[] }

/** Common presentation adapter with explicit known fields and a normalized grid ID. */
export interface AdminRow {
  id: number
  name?: string
  email?: string
  is_admin?: boolean
  engineer_profile?: User['engineer_profile']
  user_id?: number
  is_available?: boolean
  title?: string
  description?: string
  status?: IncidentStatus
  priority?: Incident['priority']
  category?: Incident['category']
  reporter_id?: number
  reporter_name?: string | null
  assignee_id?: number | null
  assignee_name?: string | null
  building_id?: number
  floor_id?: number | null
  seat_id?: number | null
  label?: string
  created_at?: string
  assigned_at?: string | null
  acknowledged_at?: string | null
  resolved_at?: string | null
  blocked_reason?: string | null
  escalation_reason?: string | null
  incident_id?: number
  author_id?: number
  author_name?: string
  body?: string
  is_engineer?: boolean
  user_name?: string
  user_email?: string
  building_name?: string
  floor_name?: string
  escalated?: boolean
}
export type FormFieldName = keyof AdminRow | 'password'
export type FormRow = Partial<Record<FormFieldName, unknown>>
export type FormValue = string | number | boolean
export type FormValues = Partial<Record<FormFieldName, FormValue>>

/** A referenced record used by select inputs and readable grid labels. */
export interface Option {
  value: string | number
  label: string
}

/** Relationships retain their transport types, including engineer user_id keys. */
export interface Lookups {
  users: User[]
  buildings: Building[]
  floors: Floor[]
  seats: Seat[]
}
