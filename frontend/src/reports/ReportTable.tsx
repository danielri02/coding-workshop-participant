import { useState } from 'react'
import { Button } from '@mui/material'
import type { GridColDef, GridPaginationModel, GridSortModel } from '@mui/x-data-grid'
import { DataTable } from '../components/DataTable'
import { RecordDetailsDialog } from '../components/RecordDetailsDialog'
import { useLookups } from '../hooks/useLookups'
import { resources } from '../resources/definitions'
import type { ApiSchemas } from '../types'
import { duration, type Report } from './query'

type TimingRow = ApiSchemas['TimingRow']
const incidentResource = resources.find((resource) => resource.key === 'incidents')!

function IncidentDetails({ id, onClose }: { id: number; onClose: () => void }) {
  const lookups = useLookups(incidentResource)
  return (
    <RecordDetailsDialog
      resource={incidentResource}
      row={{ id }}
      lookups={lookups.data}
      onClose={onClose}
    />
  )
}

interface Props {
  report: Report
  loading: boolean
  pagination: GridPaginationModel
  sorting: GridSortModel
  onPagination: (model: GridPaginationModel) => void
  onSorting: (model: GridSortModel) => void
}

/** Aggregate grids paginate locally; incident timing rows page and sort on the backend. */
export function ReportTable({
  report,
  loading,
  pagination,
  sorting,
  onPagination,
  onSorting,
}: Props) {
  const [viewing, setViewing] = useState<number | null>(null)
  const common = {
    loading,
    initialState: { pagination: { paginationModel: { page: 0, pageSize: 25 } } },
  }
  if (report.report === 'locations') {
    const columns: GridColDef<ApiSchemas['LocationRow']>[] = [
      { field: 'building_name', headerName: 'Building', width: 220 },
      ...(report.level !== 'building'
        ? [{ field: 'floor_label', headerName: 'Floor', width: 130 }]
        : []),
      ...(report.level === 'seat' ? [{ field: 'seat_label', headerName: 'Seat', width: 130 }] : []),
      { field: 'category', headerName: 'Category', width: 170 },
      { field: 'incident_count', headerName: 'Incidents', type: 'number', width: 130 },
      { field: 'active_count', headerName: 'Active', type: 'number', width: 130 },
    ]
    return <DataTable key={report.level} {...common} rows={report.rows} columns={columns} />
  }
  if (report.report === 'categories') {
    const columns: GridColDef<ApiSchemas['CategoryRow']>[] = [
      { field: 'category', headerName: 'Category', width: 230 },
      { field: 'incident_count', headerName: 'Incidents', type: 'number', width: 140 },
      { field: 'active_count', headerName: 'Active', type: 'number', width: 140 },
      {
        field: 'percentage',
        headerName: 'Share of incidents',
        type: 'number',
        width: 180,
        valueFormatter: (value: number) => `${value.toFixed(1)}%`,
      },
    ]
    return <DataTable {...common} rows={report.rows} columns={columns} />
  }
  if (report.report === 'workload') {
    const columns: GridColDef<ApiSchemas['WorkloadRow']>[] = [
      { field: 'name', headerName: 'Engineer', width: 230 },
      { field: 'is_available', headerName: 'Available', type: 'boolean', width: 120 },
      { field: 'active_count', headerName: 'Active', type: 'number', width: 100 },
      { field: 'open_count', headerName: 'Open', type: 'number', width: 100 },
      { field: 'in_progress_count', headerName: 'In Progress', type: 'number', width: 130 },
      { field: 'blocked_count', headerName: 'Blocked', type: 'number', width: 110 },
      {
        field: 'high_priority_count',
        headerName: 'High priority active',
        type: 'number',
        width: 180,
      },
      { field: 'total_count', headerName: 'All assigned', type: 'number', width: 140 },
    ]
    return <DataTable {...common} rows={report.rows} columns={columns} />
  }
  if (report.report !== 'timings') return null
  const columns: GridColDef<TimingRow>[] = [
    { field: 'id', headerName: 'ID', width: 85 },
    { field: 'title', headerName: 'Incident', width: 300 },
    { field: 'status', headerName: 'Status', width: 130 },
    { field: 'category', headerName: 'Category', width: 140 },
    { field: 'assignee_name', headerName: 'Engineer', width: 200 },
    ...(
      [
        ['assigned_minutes', 'First assignment'],
        ['acknowledged_minutes', 'Acknowledgment'],
        ['resolved_minutes', 'Resolution'],
      ] as const
    ).map(([field, headerName]) => ({
      field,
      headerName,
      type: 'number' as const,
      width: 170,
      valueFormatter: duration,
    })),
    {
      field: 'created_at',
      headerName: 'Created',
      width: 200,
      valueFormatter: (value: string) => new Date(value).toLocaleString(),
    },
    {
      field: 'actions',
      headerName: 'Details',
      width: 100,
      sortable: false,
      renderCell: ({ row }: { row: TimingRow }) => (
        <Button
          size="small"
          aria-label={`View incident ${row.id}`}
          onClick={() => setViewing(row.id)}
        >
          View
        </Button>
      ),
    },
  ].map((column) => ({ ...column, filterable: false }))
  return (
    <>
      <DataTable
        rows={report.rows}
        columns={columns}
        loading={loading}
        rowCount={report.row_count}
        paginationMode="server"
        sortingMode="server"
        filterMode="server"
        disableColumnFilter
        paginationModel={pagination}
        onPaginationModelChange={onPagination}
        sortModel={sorting}
        onSortModelChange={onSorting}
        onRowDoubleClick={({ row }) => setViewing(row.id)}
      />
      {viewing !== null && <IncidentDetails id={viewing} onClose={() => setViewing(null)} />}
    </>
  )
}
