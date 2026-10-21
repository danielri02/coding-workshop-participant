import { useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  InputAdornment,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import Add from '@mui/icons-material/Add'
import Refresh from '@mui/icons-material/Refresh'
import Search from '@mui/icons-material/Search'
import type { GridFilterModel, GridPaginationModel, GridSortModel } from '@mui/x-data-grid'
import { useOutletContext, useSearchParams } from 'react-router-dom'
import PropTypes from 'prop-types'
import type { AdminOutlet } from '../components/AdminLayout'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { RecordDetailsDialog } from '../components/RecordDetailsDialog'
import { RecordFormDialog } from '../components/RecordFormDialog'
import { ResourceGrid } from '../components/ResourceGrid'
import { useApiQuery, useDebouncedValue } from '../hooks/useApiQuery'
import { useLookups } from '../hooks/useLookups'
import { useResourceActions } from '../hooks/useResourceActions'
import { activeStatuses, incidentGrid } from '../generated/domain'
import type { ResourceDefinition } from '../resources/definitions'
import { incidentQuery } from '../resources/incidentQuery'
import { decorateRow } from '../resources/rows'
import type { ApiRecord, Incident, IncidentPage } from '../types'

/** Compose reusable admin controls around the selected resource's query and actions. */
export function ResourcePage({ resource }: { resource: ResourceDefinition }) {
  const { changed } = useOutletContext<AdminOutlet>()
  const [searchParams, setSearchParams] = useSearchParams()
  const scope = Number(searchParams.get('incident')) || 0
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search)
  const [pagination, setPagination] = useState<GridPaginationModel>({ page: 0, pageSize: 25 })
  const [sorting, setSorting] = useState<GridSortModel>([{ field: 'id', sort: 'asc' }])
  const [filters, setFilters] = useState<GridFilterModel>({ items: [] })
  const {
    user,
    editor,
    setEditor,
    viewing,
    setViewing,
    confirmation,
    setConfirmation,
    busy,
    error,
    action,
    save,
    confirm,
    fields,
    formRow,
    formTitle,
  } = useResourceActions(resource, scope, changed)
  const lookups = useLookups(resource)
  const incidents = useApiQuery<Incident[]>(resource.key === 'notes' ? '/incidents' : null, [])
  const selectedIncident = incidents.data.find((row) => row.id === scope)
  const server = resource.key === 'incidents'
  const path = server
    ? incidentQuery(pagination, sorting, filters, debouncedSearch)
    : resource.key === 'notes'
      ? scope
        ? `/incidents/${scope}/notes`
        : null
      : resource.endpoint
  const query = useApiQuery<ApiRecord[] | IncidentPage>(path, [])
  const rows = (Array.isArray(query.data) ? query.data : query.data.rows).map((row) =>
    decorateRow(resource.key, row, lookups.data),
  )
  const rowCount = Array.isArray(query.data) ? 0 : query.data.row_count
  const loading =
    query.loading || lookups.loading || incidents.loading || (server && search !== debouncedSearch)
  const failure = query.error || lookups.error || incidents.error
  const columns = useMemo(() => resource.columns(lookups.data), [resource, lookups.data])
  const activeNotes = activeStatuses.some((status) => status === selectedIncident?.status)
  return (
    <Stack spacing={3} sx={{ minWidth: 0, width: '100%' }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between', gap: 2 }}
      >
        <Box>
          <Typography variant="h4" component="h1" sx={{ fontWeight: 750 }}>
            {resource.title}
          </Typography>
          <Typography color="text.secondary" variant="body2" sx={{ mt: 1 }}>
            {resource.description}
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={() => setEditor({ action: 'create', row: null })}
          disabled={
            loading || Boolean(failure) || (resource.key === 'notes' && (!scope || !activeNotes))
          }
        >
          New {resource.singular}
        </Button>
      </Stack>
      {resource.key === 'notes' && (
        <Paper variant="outlined" sx={{ p: 2.5 }}>
          <TextField
            select
            fullWidth
            label="Incident"
            value={selectedIncident ? scope : ''}
            disabled={incidents.loading}
            onChange={(event) => {
              setSearchParams({ incident: event.target.value })
              setPagination((previous) => ({ ...previous, page: 0 }))
            }}
            helperText="Choose the incident whose shared conversation you want to manage."
          >
            {incidents.data.map((row) => (
              <MenuItem key={row.id} value={row.id}>
                #{row.id} · {String(row.title)} · {String(row.status)}
              </MenuItem>
            ))}
          </TextField>
        </Paper>
      )}
      {resource.key === 'notes' && selectedIncident && !activeNotes && (
        <Alert severity="info">
          This incident is {String(selectedIncident.status).toLowerCase()}. Existing notes can be
          read, corrected or deleted; new notes require an active incident.
        </Alert>
      )}
      {failure && (
        <Alert
          severity="error"
          action={<Button onClick={() => changed('Reloading records…')}>Retry</Button>}
        >
          {failure}
        </Alert>
      )}
      <Paper variant="outlined" sx={{ minWidth: 0, width: '100%', overflow: 'hidden' }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          sx={{
            p: 2,
            borderBottom: '1px solid',
            borderColor: 'divider',
            alignItems: { xs: 'stretch', sm: 'center' },
            gap: 2,
          }}
        >
          <TextField
            size="small"
            label={`Search ${resource.title.toLowerCase()}`}
            placeholder={server ? 'Search titles and descriptions' : 'Search records'}
            value={search}
            disabled={resource.key === 'notes' && !scope}
            onChange={(event) => {
              setSearch(event.target.value)
              setPagination((previous) => ({ ...previous, page: 0 }))
            }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <Search fontSize="small" />
                  </InputAdornment>
                ),
              },
              htmlInput: { maxLength: server ? incidentGrid.searchMaxLength : undefined },
            }}
            sx={{ width: { xs: '100%', sm: 360 }, minWidth: 0 }}
          />
          <Button
            startIcon={<Refresh />}
            onClick={() => changed('Reloading records…')}
            disabled={loading}
            sx={{ ml: { sm: 'auto' }, flexShrink: 0 }}
          >
            Refresh
          </Button>
        </Stack>
        {resource.key === 'notes' && !scope ? (
          <Box sx={{ p: { xs: 3, sm: 8 }, textAlign: 'center' }}>
            <Typography sx={{ fontWeight: 600 }}>Choose an incident to view its notes</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              The conversation includes updates from employees, engineers and admins.
            </Typography>
          </Box>
        ) : (
          <ResourceGrid
            resource={resource.key}
            rows={rows}
            columns={columns}
            loading={loading}
            disabled={loading || Boolean(failure)}
            rowCount={rowCount}
            pagination={pagination}
            sorting={sorting}
            filters={
              server
                ? filters
                : {
                    ...filters,
                    quickFilterValues: debouncedSearch.trim()
                      ? debouncedSearch.trim().split(/\s+/)
                      : [],
                  }
            }
            onPagination={setPagination}
            onSorting={(model) => {
              setSorting(model)
              setPagination((previous) => ({ ...previous, page: 0 }))
            }}
            onFilters={(model) => {
              setFilters(model)
              setPagination((previous) => ({ ...previous, page: 0 }))
            }}
            onAction={action}
          />
        )}
      </Paper>
      {editor && (
        <RecordFormDialog
          key={`${editor.action}:${editor.row?.id || 'new'}`}
          title={formTitle}
          fields={fields}
          lookups={lookups.data}
          row={formRow}
          onClose={() => setEditor(null)}
          onSave={save}
          subtitle={
            resource.key === 'notes' && editor.action === 'create'
              ? `For incident #${scope}: ${String(selectedIncident?.title)}`
              : editor.action === 'create' && resource.key === 'incidents'
                ? 'You will be recorded as the reporter. The incident starts Open and unassigned.'
                : undefined
          }
        />
      )}
      {viewing && (
        <RecordDetailsDialog
          resource={resource}
          row={viewing}
          lookups={lookups.data}
          onClose={() => setViewing(null)}
        />
      )}
      {confirmation && (
        <ConfirmDialog
          title={
            confirmation.action === 'delete'
              ? `Delete ${resource.singular}?`
              : confirmation.row.is_admin
                ? 'Remove admin access?'
                : 'Grant admin access?'
          }
          description={
            confirmation.action === 'delete'
              ? `Delete ${String(confirmation.row.name || confirmation.row.title || confirmation.row.label || `record #${confirmation.row.id}`)}? This cannot be undone.`
              : `Change administrator access for ${String(confirmation.row.name)}?${confirmation.row.id === user?.id && confirmation.row.is_admin ? ' Your account will leave the admin workspace.' : ''}`
          }
          busy={busy}
          error={error}
          onClose={() => setConfirmation(null)}
          onConfirm={() => void confirm()}
        />
      )}
    </Stack>
  )
}

ResourcePage.propTypes = { resource: PropTypes.object.isRequired }
