import { useMemo, useState } from 'react'
import { Alert, Box, Button, Paper, Stack, TextField, Typography } from '@mui/material'
import Add from '@mui/icons-material/Add'
import Refresh from '@mui/icons-material/Refresh'
import { useQueryClient } from '@tanstack/react-query'
import type { GridFilterModel, GridPaginationModel, GridSortModel } from '@mui/x-data-grid'
import { useRecordDialogs } from '../dialogs/context'
import { useAuth } from '../auth/context'
import { DataTable } from '../components/DataTable'
import { RecordFormDialog } from '../components/RecordFormDialog'
import { useApiQuery, useDebouncedValue } from '../hooks/useApiQuery'
import { incidentGrid } from '../generated/domain'
import { useLookups } from '../hooks/useLookups'
import { incidentFields } from '../resources/incidentFields'
import { incidentQuery } from '../resources/incidentQuery'
import { api } from '../services/client'
import { invalidateResourceQueries } from '../services/queries'
import type { Incident, IncidentPage } from '../types'
import { incidentColumns } from './columns'
import { incidentViews, type IncidentScope } from './scope'
import { IncidentSummary } from './IncidentSummary'

/** Share search/paging and creation while enforcing the selected incident scope. */
export function IncidentListPage({ scope }: { scope: IncidentScope }) {
  const view = incidentViews[scope]
  const { user } = useAuth()
  const { openRecord } = useRecordDialogs()
  const client = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search)
  const [pagination, setPagination] = useState<GridPaginationModel>({ page: 0, pageSize: 25 })
  const [sorting, setSorting] = useState<GridSortModel>([incidentGrid.defaultSort])
  const [filters, setFilters] = useState<GridFilterModel>({ items: [] })
  const lookups = useLookups({ lookups: ['buildings', 'floors', 'seats'] })
  const path = incidentQuery(
    pagination,
    sorting,
    filters,
    debouncedSearch,
    scope === 'assigned' ? { assignee_id: user!.id } : { reporter_id: user!.id },
  )
  const query = useApiQuery<IncidentPage>(path, { rows: [], row_count: 0, page: 0, page_size: 25 })
  const columns = useMemo(() => incidentColumns(lookups.data, scope), [lookups.data, scope])
  const refresh = () =>
    void invalidateResourceQueries(client, 'incidents', ['buildings', 'floors', 'seats'])
  const resetPage = () => setPagination((previous) => ({ ...previous, page: 0 }))
  const save = async (payload: Record<string, unknown>) => {
    const incident = await api<Incident>('/incidents', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    await invalidateResourceQueries(client, 'incidents')
    setCreating(false)
    openRecord('incidents', incident.id, { scope })
  }
  const failure = query.error || lookups.error
  return (
    <Stack spacing={3} sx={{ minWidth: 0 }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}
      >
        <Box>
          <Typography component="h1" variant="h4" sx={{ fontWeight: 750 }}>
            {view.title}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {view.description}
          </Typography>
        </Box>
        {scope === 'reported' && (
          <Button
            variant="contained"
            startIcon={<Add />}
            onClick={() => setCreating(true)}
            disabled={lookups.loading || Boolean(lookups.error)}
          >
            New incident
          </Button>
        )}
      </Stack>
      <IncidentSummary key={scope} scope={scope} onRefresh={refresh} />
      {failure && (
        <Alert severity="error" action={<Button onClick={refresh}>Retry</Button>}>
          {failure}
        </Alert>
      )}
      <Paper variant="outlined" sx={{ minWidth: 0, overflow: 'hidden' }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          sx={{ p: 2, justifyContent: 'space-between' }}
        >
          <TextField
            label={view.search}
            placeholder="Search titles and descriptions"
            size="small"
            value={search}
            slotProps={{ htmlInput: { maxLength: incidentGrid.searchMaxLength } }}
            sx={{ width: { xs: '100%', sm: 360 } }}
            onChange={(event) => {
              setSearch(event.target.value)
              resetPage()
            }}
          />
          <Button startIcon={<Refresh />} onClick={refresh} disabled={query.loading}>
            Refresh
          </Button>
        </Stack>
        <DataTable
          rows={query.data.rows}
          columns={columns}
          loading={query.loading || lookups.loading || search !== debouncedSearch}
          rowCount={query.data.row_count}
          paginationMode="server"
          sortingMode="server"
          filterMode="server"
          paginationModel={pagination}
          onPaginationModelChange={setPagination}
          sortModel={sorting}
          onSortModelChange={(model) => {
            setSorting(model)
            resetPage()
          }}
          filterModel={filters}
          onFilterModelChange={(model) => {
            setFilters(model)
            resetPage()
          }}
        />
      </Paper>
      {creating && scope === 'reported' && (
        <RecordFormDialog
          title="New incident"
          fields={incidentFields}
          lookups={lookups.data}
          onSave={save}
          onClose={() => setCreating(false)}
          subtitle="This report will be submitted in your name and start Open with Low priority. Facilities admins handle escalation. Building is required; floor and seat are optional."
        />
      )}
    </Stack>
  )
}
