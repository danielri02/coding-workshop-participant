import type {
  GridColDef,
  GridPaginationModel,
  GridSortModel,
  GridRenderCellParams,
} from '@mui/x-data-grid'
import { DataTable } from '../components/DataTable'
import { RecordLink } from '../components/RecordLink'
import type { ApiSchemas } from '../types'
import { duration, type Report } from './query'

type TimingRow = ApiSchemas['TimingRow']

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
  const common = {
    loading,
    initialState: { pagination: { paginationModel: { page: 0, pageSize: 25 } } },
  }
  if (report.report === 'locations') {
    const columns: GridColDef<ApiSchemas['LocationRow']>[] = [
      {
        field: 'building_name',
        headerName: 'Building',
        width: 220,
        renderCell: ({ row, hasFocus }) => (
          <RecordLink resource="buildings" id={row.building_id} tabIndex={hasFocus ? 0 : -1}>
            {row.building_name}
          </RecordLink>
        ),
      },
      ...(report.level !== 'building'
        ? [
            {
              field: 'floor_label',
              headerName: 'Floor',
              width: 130,
              renderCell: ({
                row,
                hasFocus,
              }: {
                row: ApiSchemas['LocationRow']
                hasFocus: boolean
              }) =>
                row.floor_id && (
                  <RecordLink resource="floors" id={row.floor_id} tabIndex={hasFocus ? 0 : -1}>
                    {row.floor_label}
                  </RecordLink>
                ),
            },
          ]
        : []),
      ...(report.level === 'seat'
        ? [
            {
              field: 'seat_label',
              headerName: 'Seat',
              width: 130,
              renderCell: ({
                row,
                hasFocus,
              }: {
                row: ApiSchemas['LocationRow']
                hasFocus: boolean
              }) =>
                row.seat_id && (
                  <RecordLink resource="seats" id={row.seat_id} tabIndex={hasFocus ? 0 : -1}>
                    {row.seat_label}
                  </RecordLink>
                ),
            },
          ]
        : []),
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
      {
        field: 'name',
        headerName: 'Engineer',
        width: 230,
        renderCell: ({ row, hasFocus }) => (
          <RecordLink resource="engineers" id={row.id} tabIndex={hasFocus ? 0 : -1}>
            {row.name}
          </RecordLink>
        ),
      },
      { field: 'is_available', headerName: 'Available', type: 'boolean', width: 120 },
      { field: 'active_count', headerName: 'Active', type: 'number', width: 100 },
      { field: 'open_count', headerName: 'Open', type: 'number', width: 100 },
      { field: 'assigned_count', headerName: 'Awaiting acceptance', type: 'number', width: 180 },
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
    {
      field: 'id',
      headerName: 'ID',
      width: 85,
      renderCell: ({ row, hasFocus }: GridRenderCellParams<TimingRow>) => (
        <RecordLink
          resource="incidents"
          id={row.id}
          tabIndex={hasFocus ? 0 : -1}
        >{`#${row.id}`}</RecordLink>
      ),
    },
    {
      field: 'title',
      headerName: 'Incident',
      width: 300,
      renderCell: ({ row, hasFocus }: GridRenderCellParams<TimingRow>) => (
        <RecordLink resource="incidents" id={row.id} tabIndex={hasFocus ? 0 : -1}>
          {row.title}
        </RecordLink>
      ),
    },
    { field: 'status', headerName: 'Status', width: 130 },
    { field: 'category', headerName: 'Category', width: 140 },
    {
      field: 'assignee_name',
      headerName: 'Engineer',
      width: 200,
      renderCell: ({ row, hasFocus }: GridRenderCellParams<TimingRow>) =>
        row.assignee_id ? (
          <RecordLink resource="engineers" id={row.assignee_id} tabIndex={hasFocus ? 0 : -1}>
            {row.assignee_name || `#${row.assignee_id}`}
          </RecordLink>
        ) : (
          'Unassigned'
        ),
    },
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
  ].map((column) => ({ ...column, filterable: false }))
  return (
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
    />
  )
}
