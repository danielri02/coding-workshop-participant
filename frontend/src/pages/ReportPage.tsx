import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Alert, Box, Button, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material'
import Refresh from '@mui/icons-material/Refresh'
import type { GridPaginationModel, GridSortModel } from '@mui/x-data-grid'
import { useAuth } from '../auth/context'
import { useApiQuery, useDebouncedValue } from '../hooks/useApiQuery'
import type { ReportDefinition } from '../reports/definitions'
import { ReportSummary } from '../reports/ReportSummary'
import { ReportTable } from '../reports/ReportTable'
import { reportQuery, type LocationLevel, type Report, type Scope } from '../reports/query'

/** Compose scoped summaries and grids without duplicating the CRUD incident views. */
export function ReportPage({ definition }: { definition: ReportDefinition }) {
  const { user } = useAuth()
  const client = useQueryClient()
  const [scope, setScope] = useState<Scope>('visible')
  const [level, setLevel] = useState<LocationLevel>('building')
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search)
  const [pagination, setPagination] = useState<GridPaginationModel>({ page: 0, pageSize: 25 })
  const [sorting, setSorting] = useState<GridSortModel>([{ field: 'created_at', sort: 'desc' }])
  const path = reportQuery(definition.key, scope, level, pagination, sorting, debouncedSearch)
  const query = useApiQuery<Report | null>(path, null)
  const loading = query.loading || search !== debouncedSearch
  const resetPage = () => setPagination((previous) => ({ ...previous, page: 0 }))
  const refresh = () => void client.invalidateQueries({ queryKey: ['api', path] })
  return (
    <Stack spacing={3} sx={{ minWidth: 0, width: '100%' }}>
      <Box>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 750 }}>
          {definition.title}
        </Typography>
        <Typography color="text.secondary" variant="body2" sx={{ mt: 1 }}>
          {definition.description}
        </Typography>
      </Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ flexWrap: 'wrap' }}>
        {definition.key !== 'workload' && (
          <TextField
            select
            size="small"
            label="Incident scope"
            value={scope}
            sx={{ minWidth: 210 }}
            onChange={(event) => {
              setScope(event.target.value as Scope)
              resetPage()
            }}
          >
            <MenuItem value="visible">All incidents</MenuItem>
            <MenuItem value="personal">My reported incidents</MenuItem>
            {user?.engineer_profile && <MenuItem value="assigned">My assigned incidents</MenuItem>}
          </TextField>
        )}
        {definition.key === 'locations' && (
          <TextField
            select
            size="small"
            label="Group by location"
            value={level}
            sx={{ minWidth: 190 }}
            onChange={(event) => setLevel(event.target.value as LocationLevel)}
          >
            <MenuItem value="building">Building</MenuItem>
            <MenuItem value="floor">Floor</MenuItem>
            <MenuItem value="seat">Seat</MenuItem>
          </TextField>
        )}
        {definition.key === 'timings' && (
          <TextField
            size="small"
            label="Search incidents"
            placeholder="Search titles and descriptions"
            value={search}
            slotProps={{ htmlInput: { maxLength: 200 } }}
            sx={{ minWidth: 230, flex: 1 }}
            onChange={(event) => {
              setSearch(event.target.value)
              resetPage()
            }}
          />
        )}
        <Button
          startIcon={<Refresh />}
          onClick={refresh}
          disabled={loading}
          sx={{ ml: { sm: 'auto !important' } }}
        >
          Refresh
        </Button>
      </Stack>
      {query.error && (
        <Alert severity="error" action={<Button onClick={refresh}>Retry</Button>}>
          {query.error}
        </Alert>
      )}
      {query.data && !query.error && (
        <>
          <ReportSummary report={query.data} />
          <Paper variant="outlined" sx={{ minWidth: 0, width: '100%', overflow: 'hidden' }}>
            <Box sx={{ px: 2.5, py: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
              <Typography variant="body2" color="text.secondary">
                {definition.key === 'locations'
                  ? 'All time. Groups require at least two incidents in the same category. Floor and seat views include only incidents with those locations recorded.'
                  : definition.key === 'timings'
                    ? 'Elapsed time from creation. Acknowledgment is the first move to In Progress. Averages cover every matching incident, across all pages; missing milestones are excluded.'
                    : definition.key === 'workload'
                      ? 'Active means Open, In Progress or Blocked. Availability is independent of assignment count.'
                      : 'All time. Share is calculated from every incident in the selected scope. Categories with no incidents remain visible.'}
              </Typography>
            </Box>
            <ReportTable
              report={query.data}
              loading={loading}
              pagination={pagination}
              sorting={sorting}
              onPagination={setPagination}
              onSorting={(model) => {
                setSorting(model)
                resetPage()
              }}
            />
          </Paper>
        </>
      )}
      {!query.data && !query.error && <Typography role="status">Loading report…</Typography>}
    </Stack>
  )
}
