import type { GridColDef } from '@mui/x-data-grid'
import {
  getGridBooleanOperators,
  getGridSingleSelectOperators,
  getGridStringOperators,
  getGridDateOperators,
} from '@mui/x-data-grid'
import { RecordLink } from '../components/RecordLink'
import { RelatedLink } from '../components/RelatedLink'
import { PersonLink } from '../components/PersonLink'
import { ValueChip } from '../components/ValueChip'
import { statuses, priorities, categories, constraints } from '../generated/domain'
import type { Field } from './forms'
import { adminIncidentFields, locationFields, noteFields } from './incidentFields'
import { userFields } from './userFields'
import { floorLabel } from './rows'
import type { AdminRow, Lookups, ResourceKey } from '../types'

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

const text = (field: keyof AdminRow, headerName: string, width = 180): GridColDef<AdminRow> => ({
  field,
  headerName,
  width,
  minWidth: Math.min(width, 220),
  filterOperators: getGridStringOperators(),
})
const flag = (field: keyof AdminRow, headerName: string): GridColDef<AdminRow> => ({
  field,
  headerName,
  width: 130,
  type: 'boolean',
  filterOperators: getGridBooleanOperators(),
  renderCell: ({ value }) => <ValueChip value={Boolean(value)} />,
})
const tag = (
  field: keyof AdminRow,
  headerName: string,
  values: readonly string[],
): GridColDef<AdminRow> => ({
  field,
  headerName,
  width: 150,
  type: 'singleSelect',
  valueOptions: [...values],
  renderCell: ({ value }) => <ValueChip value={String(value)} />,
})

export const resources: ResourceDefinition[] = [
  {
    key: 'incidents',
    title: 'Incidents',
    singular: 'incident',
    endpoint: '/incidents',
    description: 'Coordinate workplace issues, assignments and progress.',
    lookups: ['users', 'buildings', 'floors', 'seats'],
    fields: adminIncidentFields,
    columns: (data) => {
      const columns: GridColDef<AdminRow>[] = [
        {
          ...text('title', 'Incident', 280),
          flex: 1,
          minWidth: 220,
          renderCell: ({ row, hasFocus }) => (
            <RecordLink resource="incidents" id={row.id} tabIndex={hasFocus ? 0 : -1}>
              {row.title}
            </RecordLink>
          ),
        },
        tag('status', 'Status', statuses),
        { ...text('blocked_reason', 'Blocked reason', 320), sortable: false, filterable: false },
        tag('priority', 'Priority', priorities),
        {
          ...text('escalation_reason', 'Escalation reason', 320),
          sortable: false,
          filterable: false,
        },
        {
          ...text('category', 'Category', 145),
          type: 'singleSelect',
          valueOptions: [...categories],
        },
        {
          ...text('building_id', 'Building', 190),
          type: 'singleSelect',
          valueOptions: data.buildings.map((row) => ({ value: row.id, label: String(row.name) })),
          renderCell: ({ row, formattedValue, hasFocus }) => (
            <RecordLink resource="buildings" id={row.building_id!} tabIndex={hasFocus ? 0 : -1}>
              {String(formattedValue)}
            </RecordLink>
          ),
        },
        {
          ...text('assignee_id', 'Assigned engineer', 180),
          renderCell: ({ row, formattedValue, hasFocus }) =>
            row.assignee_id ? (
              <RecordLink resource="engineers" id={row.assignee_id} tabIndex={hasFocus ? 0 : -1}>
                {row.assignee_name || String(formattedValue || `#${row.assignee_id}`)}
              </RecordLink>
            ) : (
              'Unassigned'
            ),
          type: 'singleSelect',
          valueOptions: data.users
            .filter((row) => row.engineer_profile)
            .map((row) => ({ value: row.id, label: String(row.name) })),
        },
        {
          field: 'notes',
          headerName: 'Notes',
          width: 115,
          sortable: false,
          filterable: false,
          renderCell: ({ row, hasFocus }) => (
            <RelatedLink
              resource="notes"
              filters={{ incident_id: row.id }}
              title={`Notes for incident #${row.id}`}
              tabIndex={hasFocus ? 0 : -1}
            >
              View notes
            </RelatedLink>
          ),
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
    fields: userFields,
    columns: () => [
      {
        ...text('name', 'Name', 220),
        flex: 1,
        renderCell: ({ row, hasFocus }) => (
          <RecordLink resource="users" id={row.id} tabIndex={hasFocus ? 0 : -1}>
            {row.name}
          </RecordLink>
        ),
      },
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
      {
        ...text('user_name', 'Engineer', 240),
        flex: 1,
        renderCell: ({ row, hasFocus }) => (
          <RecordLink resource="engineers" id={row.id} tabIndex={hasFocus ? 0 : -1}>
            {row.user_name}
          </RecordLink>
        ),
      },
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
    fields: [
      { name: 'name', label: 'Building name', required: true, ...constraints.UserCreate.name },
    ],
    columns: () => [
      {
        ...text('name', 'Building name', 320),
        flex: 1,
        renderCell: ({ row, hasFocus }) => (
          <RecordLink resource="buildings" id={row.id} tabIndex={hasFocus ? 0 : -1}>
            {row.name}
          </RecordLink>
        ),
      },
    ],
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
      { name: 'label', label: 'Floor label', required: true, ...constraints.FloorCreate.label },
    ],
    columns: () => [
      {
        ...text('building_name', 'Building', 300),
        flex: 1,
        renderCell: ({ row, hasFocus }) => (
          <RecordLink resource="buildings" id={row.building_id!} tabIndex={hasFocus ? 0 : -1}>
            {row.building_name}
          </RecordLink>
        ),
      },
      {
        ...text('label', 'Floor label', 240),
        renderCell: ({ row, hasFocus }) => (
          <RecordLink resource="floors" id={row.id} tabIndex={hasFocus ? 0 : -1}>
            {row.label}
          </RecordLink>
        ),
      },
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
      { name: 'label', label: 'Seat label', required: true, ...constraints.FloorCreate.label },
    ],
    columns: () => [
      {
        ...text('floor_name', 'Building / floor', 340),
        flex: 1,
        renderCell: ({ row, hasFocus }) => (
          <RecordLink resource="floors" id={row.floor_id!} tabIndex={hasFocus ? 0 : -1}>
            {row.floor_name}
          </RecordLink>
        ),
      },
      {
        ...text('label', 'Seat label', 240),
        renderCell: ({ row, hasFocus }) => (
          <RecordLink resource="seats" id={row.id} tabIndex={hasFocus ? 0 : -1}>
            {row.label}
          </RecordLink>
        ),
      },
    ],
  },
  {
    key: 'notes',
    title: 'Notes',
    singular: 'note',
    endpoint: '/notes',
    description: 'Read and manage the shared conversation on each incident.',
    lookups: [],
    fields: noteFields,
    columns: () => [
      {
        ...text('body', 'Note', 400),
        flex: 1,
        renderCell: ({ row, hasFocus }) => (
          <RecordLink resource="notes" id={row.id} tabIndex={hasFocus ? 0 : -1}>
            {row.body}
          </RecordLink>
        ),
      },
      {
        ...text('author_name', 'Author', 200),
        renderCell: ({ row, hasFocus }) => (
          <PersonLink
            id={row.author_id!}
            name={row.author_name || 'Employee'}
            tabIndex={hasFocus ? 0 : -1}
          />
        ),
      },
      {
        ...text('created_at', 'Posted', 200),
        type: 'dateTime',
        filterOperators: getGridDateOperators(true),
        valueGetter: (value) => new Date(String(value)),
      },
    ],
  },
]
