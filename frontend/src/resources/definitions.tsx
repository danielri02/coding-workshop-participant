import type { GridColDef } from '@mui/x-data-grid'
import { getGridBooleanOperators, getGridSingleSelectOperators } from '@mui/x-data-grid'
import { ValueChip } from '../components/ValueChip'
import type { AdminRow, FormValues, Lookups, Option, ResourceKey } from '../types'

/** Declarative input configuration shared by every create/edit dialog. */
export interface Field {
  name: string
  label: string
  type?: 'text' | 'email' | 'password' | 'select' | 'boolean' | 'multiline'
  required?: boolean
  minLength?: number
  maxLength?: number
  numeric?: boolean
  createOnly?: boolean
  immutable?: boolean
  defaultValue?: string | number | boolean
  helper?: string
  resets?: string[]
  options?: (lookups: Lookups, values: FormValues) => Option[]
  when?: (values: FormValues) => boolean
  requiredWhen?: (values: FormValues) => boolean
}

/** The only resource-specific configuration required by the reusable CRUD page. */
export interface ResourceDefinition {
  key: ResourceKey
  title: string
  singular: string
  description: string
  endpoint: string
  lookups: (keyof Lookups)[]
  fields: Field[]
  columns: (lookups: Lookups) => GridColDef<AdminRow>[]
}

export const statuses = ['Open', 'In Progress', 'Blocked', 'Resolved', 'Closed']
export const priorities = ['Low', 'Medium', 'High']
export const categories = ['Electrical', 'HVAC', 'Plumbing', 'Network', 'Equipment', 'Other']
export const transitions: Record<string, string[]> = {
  Open: ['In Progress'],
  'In Progress': ['Blocked', 'Resolved'],
  Blocked: ['In Progress'],
  Resolved: ['Closed'],
  Closed: [],
}

/** Find a human-readable label for a related record. */
export function recordLabel(rows: AdminRow[], id: unknown, field = 'name'): string {
  if (id === null || id === undefined || id === '') return '—'
  const row = rows.find((item) => item.id === Number(id))
  return row ? String(row[field] ?? row.id) : `#${String(id)}`
}

/** Label floors with their building so duplicate floor labels remain distinct. */
export function floorLabel(lookups: Lookups, id: unknown): string {
  const floor = lookups.floors.find((row) => row.id === Number(id))
  return floor
    ? `${recordLabel(lookups.buildings, floor.building_id)} · Floor ${String(floor.label)}`
    : '—'
}

const choices = (values: string[]): Option[] => values.map((value) => ({ value, label: value }))
const text = (field: string, headerName: string, width = 180): GridColDef<AdminRow> => ({
  field,
  headerName,
  width,
  minWidth: 100,
})
const flag = (field: string, headerName: string): GridColDef<AdminRow> => ({
  field,
  headerName,
  width: 130,
  type: 'boolean',
  renderCell: ({ value }) => <ValueChip value={Boolean(value)} />,
})
const tag = (field: string, headerName: string, values: string[]): GridColDef<AdminRow> => ({
  field,
  headerName,
  width: 150,
  type: 'singleSelect',
  valueOptions: values,
  renderCell: ({ value }) => <ValueChip value={String(value)} />,
})
const locationFields: Field[] = [
  {
    name: 'building_id',
    label: 'Building',
    type: 'select',
    required: true,
    numeric: true,
    resets: ['floor_id', 'seat_id'],
    options: (data) => data.buildings.map((row) => ({ value: row.id, label: String(row.name) })),
  },
  {
    name: 'floor_id',
    label: 'Floor',
    type: 'select',
    numeric: true,
    resets: ['seat_id'],
    options: (data, values) =>
      data.floors
        .filter((row) => row.building_id === Number(values.building_id))
        .map((row) => ({ value: row.id, label: `Floor ${String(row.label)}` })),
  },
  {
    name: 'seat_id',
    label: 'Seat',
    type: 'select',
    numeric: true,
    options: (data, values) =>
      data.seats
        .filter((row) => row.floor_id === Number(values.floor_id))
        .map((row) => ({ value: row.id, label: String(row.label) })),
  },
]

export const resources: ResourceDefinition[] = [
  {
    key: 'incidents',
    title: 'Incidents',
    singular: 'incident',
    endpoint: '/incidents',
    description: 'Coordinate workplace issues, assignments and progress.',
    lookups: ['users', 'buildings', 'floors', 'seats'],
    fields: [
      { name: 'title', label: 'Title', required: true, maxLength: 200 },
      {
        name: 'description',
        label: 'Description',
        type: 'multiline',
        required: true,
        maxLength: 10000,
      },
      {
        name: 'category',
        label: 'Category',
        type: 'select',
        required: true,
        options: () => choices(categories),
      },
      ...locationFields,
      {
        name: 'priority',
        label: 'Priority',
        type: 'select',
        required: true,
        defaultValue: 'Medium',
        createOnly: true,
        options: () => choices(priorities),
      },
      {
        name: 'escalation_reason',
        label: 'Escalation reason',
        type: 'multiline',
        maxLength: 2000,
        createOnly: true,
      },
    ],
    columns: (data) => {
      const columns: GridColDef<AdminRow>[] = [
        { ...text('title', 'Incident', 280), flex: 1, minWidth: 220 },
        tag('status', 'Status', statuses),
        tag('priority', 'Priority', priorities),
        { ...text('category', 'Category', 145), type: 'singleSelect', valueOptions: categories },
        {
          ...text('building_id', 'Building', 190),
          type: 'singleSelect',
          valueOptions: data.buildings.map((row) => ({ value: row.id, label: String(row.name) })),
        },
        {
          ...text('assignee_id', 'Assigned engineer', 180),
          type: 'singleSelect',
          valueOptions: data.users
            .filter((row) => row.engineer_profile)
            .map((row) => ({ value: row.id, label: String(row.name) })),
        },
        { ...flag('escalated', 'Escalated'), sortable: false },
        {
          ...text('created_at', 'Reported', 175),
          type: 'dateTime',
          valueGetter: (value: unknown) => (value ? new Date(String(value)) : null),
          filterable: false,
        },
      ]
      return columns.map((column) => ({
        ...column,
        filterable:
          column.filterable ?? (column.type === 'singleSelect' || column.type === 'boolean'),
        filterOperators:
          column.type === 'singleSelect'
            ? getGridSingleSelectOperators().filter((operator) => operator.value === 'is')
            : column.type === 'boolean'
              ? getGridBooleanOperators()
              : undefined,
      }))
    },
  },
  {
    key: 'users',
    title: 'Users',
    singular: 'user',
    endpoint: '/users',
    description: 'Manage employee accounts and administrator access.',
    lookups: [],
    fields: [
      { name: 'name', label: 'Name', required: true, maxLength: 100 },
      {
        name: 'email',
        label: 'Email',
        type: 'email',
        required: true,
        maxLength: 254,
        helper: 'Use an @acme.inc email address.',
      },
      {
        name: 'password',
        label: 'Initial password',
        type: 'password',
        required: true,
        minLength: 12,
        maxLength: 128,
        createOnly: true,
        helper: '12–128 characters. Admin access can be granted after creation.',
      },
    ],
    columns: () => [
      { ...text('name', 'Name', 220), flex: 1 },
      text('email', 'Email address', 290),
      flag('is_admin', 'Admin'),
      flag('is_engineer', 'Engineer'),
    ],
  },
  {
    key: 'engineers',
    title: 'Engineers',
    singular: 'engineer',
    endpoint: '/engineer-profiles',
    description: 'Link registered users to engineering work and manage availability.',
    lookups: ['users'],
    fields: [
      {
        name: 'user_id',
        label: 'Employee',
        type: 'select',
        required: true,
        numeric: true,
        immutable: true,
        options: (data, values) =>
          data.users
            .filter((row) => !row.engineer_profile || row.id === Number(values.user_id))
            .map((row) => ({ value: row.id, label: `${String(row.name)} · ${String(row.email)}` })),
      },
      {
        name: 'is_available',
        label: 'Available for assignment',
        type: 'boolean',
        defaultValue: true,
      },
    ],
    columns: () => [
      { ...text('user_name', 'Engineer', 240), flex: 1 },
      text('user_email', 'Email address', 290),
      flag('is_available', 'Available'),
    ],
  },
  {
    key: 'buildings',
    title: 'Buildings',
    singular: 'building',
    endpoint: '/buildings',
    description: 'Maintain the buildings where employees report incidents.',
    lookups: [],
    fields: [{ name: 'name', label: 'Building name', required: true, maxLength: 100 }],
    columns: () => [{ ...text('name', 'Building name', 320), flex: 1 }],
  },
  {
    key: 'floors',
    title: 'Floors',
    singular: 'floor',
    endpoint: '/floors',
    description: 'Organize floors within each building.',
    lookups: ['buildings'],
    fields: [
      { ...locationFields[0], immutable: true, resets: undefined },
      { name: 'label', label: 'Floor label', required: true, maxLength: 50 },
    ],
    columns: () => [
      { ...text('building_name', 'Building', 300), flex: 1 },
      text('label', 'Floor label', 240),
    ],
  },
  {
    key: 'seats',
    title: 'Seats',
    singular: 'seat',
    endpoint: '/seats',
    description: 'Maintain identifiable seats and workstations on each floor.',
    lookups: ['buildings', 'floors'],
    fields: [
      {
        name: 'floor_id',
        label: 'Floor',
        type: 'select',
        required: true,
        numeric: true,
        immutable: true,
        options: (data) =>
          data.floors.map((row) => ({ value: row.id, label: floorLabel(data, row.id) })),
      },
      { name: 'label', label: 'Seat label', required: true, maxLength: 50 },
    ],
    columns: () => [
      { ...text('floor_name', 'Building / floor', 340), flex: 1 },
      text('label', 'Seat label', 240),
    ],
  },
  {
    key: 'notes',
    title: 'Notes',
    singular: 'note',
    endpoint: '/notes',
    description: 'Read and manage the shared conversation on each incident.',
    lookups: [],
    fields: [{ name: 'body', label: 'Note', type: 'multiline', required: true, maxLength: 10000 }],
    columns: () => [
      { ...text('body', 'Note', 400), flex: 1 },
      text('author_name', 'Author', 200),
      {
        ...text('created_at', 'Posted', 200),
        type: 'dateTime',
        valueGetter: (value) => new Date(String(value)),
      },
    ],
  },
]

/** Normalize API rows and add display-only relationship labels for local grids. */
export function decorateRow(key: ResourceKey, row: AdminRow, lookups: Lookups): AdminRow {
  return {
    ...row,
    id: Number(row.id ?? row.user_id),
    ...(key === 'users' ? { is_engineer: Boolean(row.engineer_profile) } : {}),
    ...(key === 'engineers'
      ? {
          user_name: recordLabel(lookups.users, row.user_id),
          user_email: recordLabel(lookups.users, row.user_id, 'email'),
        }
      : {}),
    ...(key === 'floors' ? { building_name: recordLabel(lookups.buildings, row.building_id) } : {}),
    ...(key === 'seats' ? { floor_name: floorLabel(lookups, row.floor_id) } : {}),
    ...(key === 'incidents' ? { escalated: Boolean(row.escalation_reason) } : {}),
  }
}

/** Choose only allowed fields and send changed values for partial updates. */
export function formPayload(
  fields: Field[],
  values: FormValues,
  row: AdminRow | null,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  for (const field of fields) {
    if (row && (field.createOnly || field.immutable)) continue
    const raw = values[field.name]
    const value =
      field.type === 'boolean'
        ? Boolean(raw)
        : field.numeric
          ? raw === ''
            ? null
            : Number(raw)
          : field.type === 'password'
            ? raw
            : String(raw ?? '').trim() || null
    if (!row || (row[field.name] ?? null) !== value) payload[field.name] = value
  }
  return payload
}
