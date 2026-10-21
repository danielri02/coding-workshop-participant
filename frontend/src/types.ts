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

/** Common presentation adapter with explicit known fields and a normalized grid ID. */
export type AdminRow = { id: number } & Partial<
  User & EngineerProfile & Incident & Floor & Omit<Seat, 'floor_id'> & Note
> & {
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
