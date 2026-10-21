import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Alert, Box, Button, Paper, Stack, TextField, Typography } from '@mui/material'
import Refresh from '@mui/icons-material/Refresh'
import type { GridPaginationModel, GridSortModel } from '@mui/x-data-grid'
import { useSearchParams } from 'react-router-dom'
import { ReportFilters } from '../reports/ReportFilters'
import { useApiQuery, useDebouncedValue } from '../hooks/useApiQuery'
import type { ReportDefinition } from '../reports/definitions'
import { ReportSummary } from '../reports/ReportSummary'
import { ReportTable } from '../reports/ReportTable'
import {
  reportQuery,
  periods,
  type LocationLevel,
  type Report,
  type Scope,
  type ReportFilters as FilterValues,
} from '../reports/query'

/** Compose scoped summaries and grids without duplicating the CRUD incident views. */
export function ReportPage({ definition }: { definition: ReportDefinition }) {
  const [params, setParams] = useSearchParams()
  const client = useQueryClient()
  const scope: Scope =
    params.get('scope') === 'personal'
      ? 'personal'
      : params.get('scope') === 'assigned'
        ? 'assigned'
        : 'visible'
  const level: LocationLevel =
    params.get('level') === 'floor' ? 'floor' : params.get('level') === 'seat' ? 'seat' : 'building'
  const filters: FilterValues = {
    period: periods.find((item) => item.value === params.get('period'))?.value || 'month',
    ...Object.fromEntries(
      ['category', 'assignee_id', 'building_id', 'floor_id', 'seat_id', 'repeated_only'].map(
        (name) => [name, params.get(name) || ''],
      ),
    ),
  }
  const search = params.get('search') || ''
  const debouncedSearch = useDebouncedValue(search)
  const [pagination, setPagination] = useState<GridPaginationModel>({ page: 0, pageSize: 25 })
  const [sorting, setSorting] = useState<GridSortModel>([{ field: 'created_at', sort: 'desc' }])
  const path = reportQuery(
    definition.key,
    scope,
    level,
    pagination,
    sorting,
    debouncedSearch,
    filters,
  )
  const query = useApiQuery<Report | null>(path, null)
  const loading = query.loading || search !== debouncedSearch
  const resetPage = () => setPagination((previous) => ({ ...previous, page: 0 }))
  const changeFilters = (values: Record<string, string>, replace = false) => {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous)
        for (const [name, value] of Object.entries(values)) {
          if (value) next.set(name, value)
          else next.delete(name)
        }
        return next
      },
      { replace },
    )
    resetPage()
  }
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
      <ReportFilters
        report={definition.key}
        scope={scope}
        level={level}
        filters={filters}
        onChange={changeFilters}
      />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ flexWrap: 'wrap' }}>
        {definition.key === 'timings' && (
          <TextField
            size="small"
            label="Search incidents"
            placeholder="Search titles and descriptions"
            value={search}
            slotProps={{ htmlInput: { maxLength: 200 } }}
            sx={{ minWidth: 230, flex: 1 }}
            onChange={(event) => {
              changeFilters({ search: event.target.value }, true)
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
          {query.data.report !== 'workload' && (
            <Typography variant="body2" color="text.secondary">
              Reported{' '}
              {query.data.start_at
                ? `${new Date(query.data.start_at).toLocaleString()} – ${new Date(query.data.end_at).toLocaleString()}`
                : `at any time through ${new Date(query.data.end_at).toLocaleString()}`}
            </Typography>
          )}
          <ReportSummary report={query.data} />
          <Paper variant="outlined" sx={{ minWidth: 0, width: '100%', overflow: 'hidden' }}>
            <Box sx={{ px: 2.5, py: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
              <Typography variant="body2" color="text.secondary">
                {definition.key === 'locations'
                  ? 'Counts combine all categories unless filtered. Repeated locations have at least two incidents in this period. Floor and seat views include only incidents with those locations recorded.'
                  : definition.key === 'timings'
                    ? 'Elapsed time from reporting to each first milestone. Acknowledgment records acceptance into In Progress. Averages cover all matching incidents across pages; missing milestones are excluded. Current engineer identifies the latest assignee, including after reassignment.'
                    : definition.key === 'workload'
                      ? 'Active means Open, Assigned, In Progress or Blocked. Availability is independent of assignment count.'
                      : 'Share is calculated from all incidents reported in the selected period, location and scope. Categories with no incidents remain visible.'}
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
