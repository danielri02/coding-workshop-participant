import { Link } from '@mui/material'
import { Link as RouterLink } from 'react-router-dom'
import { getGridSingleSelectOperators, type GridColDef } from '@mui/x-data-grid'
import { ValueChip } from '../components/ValueChip'
import { categories, priorities, statuses } from '../generated/domain'
import { recordLabel } from '../resources/rows'
import type { Incident, Lookups } from '../types'

/** Display names supplied with incidents; members never need a user directory. */
export function incidentColumns(lookups: Lookups, path: string): GridColDef<Incident>[] {
  const columns: GridColDef<Incident>[] = [
    {
      field: 'title',
      headerName: 'Incident',
      width: 290,
      minWidth: 230,
      flex: 1,
      renderCell: ({ row, hasFocus }) => (
        <Link component={RouterLink} to={`${path}/${row.id}`} tabIndex={hasFocus ? 0 : -1}>
          #{row.id} · {row.title}
        </Link>
      ),
    },
    {
      field: 'status',
      headerName: 'Status',
      width: 145,
      type: 'singleSelect',
      valueOptions: [...statuses],
      renderCell: ({ value }) => <ValueChip value={String(value)} />,
    },
    {
      field: 'priority',
      headerName: 'Priority',
      width: 125,
      type: 'singleSelect',
      valueOptions: [...priorities],
      renderCell: ({ value }) => <ValueChip value={String(value)} />,
    },
    {
      field: 'category',
      headerName: 'Category',
      width: 150,
      type: 'singleSelect',
      valueOptions: [...categories],
    },
    {
      field: 'assignee_name',
      headerName: 'Assigned engineer',
      width: 190,
      valueFormatter: (value: string | null) => value || 'Awaiting assignment',
    },
    {
      field: 'building_id',
      headerName: 'Building',
      width: 190,
      type: 'singleSelect',
      valueOptions: lookups.buildings.map((row) => ({ value: row.id, label: row.name })),
      valueFormatter: (value: number) => recordLabel(lookups.buildings, value),
    },
    {
      field: 'created_at',
      headerName: 'Reported',
      width: 190,
      valueFormatter: (value: string) => new Date(value).toLocaleString(),
    },
  ]
  return columns.map((column) => ({
    ...column,
    filterable: column.type === 'singleSelect',
    filterOperators:
      column.type === 'singleSelect'
        ? getGridSingleSelectOperators().filter((operator) => operator.value === 'is')
        : undefined,
  }))
}
