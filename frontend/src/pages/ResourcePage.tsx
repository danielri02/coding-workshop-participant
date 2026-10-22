import { useEffect, useMemo, useState } from 'react'
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
import type {
  GridColumnVisibilityModel,
  GridFilterModel,
  GridPaginationModel,
  GridSortModel,
} from '@mui/x-data-grid'
import { useOutletContext, useSearchParams } from 'react-router-dom'
import type { AdminOutlet } from '../components/AdminLayout'
import { MergeIncidentDialog } from '../components/MergeIncidentDialog'
import { IncidentPicker } from '../components/IncidentPicker'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { useRecordDialogs } from '../dialogs/context'
import { RecordFormDialog } from '../components/RecordFormDialog'
import { ResourceGrid } from '../components/ResourceGrid'
import { useApiQuery, useDebouncedValue } from '../hooks/useApiQuery'
import { useLookups } from '../hooks/useLookups'
import { useResourceActions } from '../hooks/useResourceActions'
import { noteStatuses, incidentGrid } from '../generated/domain'
import type { ResourceDefinition } from '../resources/definitions'
import { defaultGridSort, gridQuery } from '../resources/gridQuery'
import {
  defaultIncidentColumns,
  incidentViews,
  incidentViewState,
} from '../resources/incidentViews'
import { decorateRow } from '../resources/rows'
import type { Incident, ResourcePageData } from '../types'

/** Compose reusable admin controls around the selected resource's query and actions. */
export function ResourcePage({ resource }: { resource: ResourceDefinition }) {
  const { changed } = useOutletContext<AdminOutlet>()
  const { openRecord } = useRecordDialogs()
  const [searchParams, setSearchParams] = useSearchParams()
  const scope = Number(searchParams.get('incident')) || 0
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search)
  const [pagination, setPagination] = useState<GridPaginationModel>({ page: 0, pageSize: 25 })
  const [sorting, setSorting] = useState<GridSortModel>([defaultGridSort(resource.key)])
  const [assignment, setAssignment] = useState('all')
  const [filters, setFilters] = useState<GridFilterModel>({ items: [] })
  const [quickView, setQuickView] = useState('all')
  const [visibility, setVisibility] = useState<GridColumnVisibilityModel>(defaultIncidentColumns)
  const customize = () => setQuickView('custom')
  const applyView = (id: string) => {
    const view = incidentViews.find((item) => item.id === id)
    if (!view) return
    const next = incidentViewState(view)
    setQuickView(view.id)
    setSearch('')
    setFilters(next.filters)
    setAssignment(next.assignment)
    setSorting(next.sorting)
    setVisibility(next.columns)
    setPagination((previous) => ({ ...previous, page: 0 }))
  }
  const {
    merge,
    setMerge,
    mergeSaved,
    editor,
    setEditor,
    confirmation,
    confirmationReady,
    confirmationTitle,
    confirmationDescription,
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
  const detailId = Number(searchParams.get('record'))
  useEffect(() => {
    if (!Number.isSafeInteger(detailId) || detailId <= 0 || detailId > 2147483647) return
    openRecord(resource.key, detailId)
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous)
        next.delete('record')
        return next
      },
      { replace: true },
    )
  }, [detailId, openRecord, resource.key, setSearchParams])
  const lookups = useLookups(resource)
  const incident = useApiQuery<Incident | null>(
    resource.key === 'notes' && scope ? `/incidents/${scope}` : null,
    null,
  )
  const selectedIncident = incident.data
  const isIncident = resource.key === 'incidents'
  const path = gridQuery(resource, pagination, sorting, filters, debouncedSearch, {
    incident_id: scope || undefined,
    unassigned: assignment === 'all' ? undefined : assignment === 'unassigned',
  })
  const query = useApiQuery<ResourcePageData>(path, {
    rows: [],
    row_count: 0,
    page: 0,
    page_size: 25,
  })
  const rows = query.data.rows.map((row) => decorateRow(resource.key, row, lookups.data))
  const rowCount = query.data.row_count
  const loading = query.loading || lookups.loading || incident.loading || search !== debouncedSearch
  const failure = query.error || lookups.error || incident.error
  const columns = useMemo(() => resource.columns(lookups.data), [resource, lookups.data])
  const canAddNotes = noteStatuses.some((status) => status === selectedIncident?.status)
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
            loading || Boolean(failure) || (resource.key === 'notes' && (!scope || !canAddNotes))
          }
        >
          New {resource.singular}
        </Button>
      </Stack>
      {resource.key === 'notes' && (
        <Paper variant="outlined" sx={{ p: 2.5 }}>
          <IncidentPicker
            id={scope || null}
            value={selectedIncident}
            onChange={(selected) => {
              setSearchParams(selected ? { incident: String(selected.id) } : {})
              setSearch('')
              setPagination((previous) => ({ ...previous, page: 0 }))
            }}
          />
        </Paper>
      )}
      {resource.key === 'notes' && selectedIncident && !canAddNotes && (
        <Alert severity="info">
          This incident is {String(selectedIncident.status).toLowerCase()}. Existing notes can be
          read, corrected or deleted; new notes are allowed until the incident is closed.
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
            flexWrap: 'wrap',
          }}
        >
          <TextField
            size="small"
            label={`Search ${resource.title.toLowerCase()}`}
            placeholder={isIncident ? 'Search titles and descriptions' : 'Search records'}
            value={search}
            disabled={resource.key === 'notes' && !scope}
            onChange={(event) => {
              customize()
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
              htmlInput: { maxLength: incidentGrid.searchMaxLength },
            }}
            sx={{ width: { xs: '100%', sm: 360 }, minWidth: 0 }}
          />
          {isIncident && (
            <TextField
              select
              label="Quick view"
              size="small"
              value={quickView}
              sx={{ minWidth: 190 }}
              onChange={(event) => applyView(event.target.value)}
            >
              {incidentViews.map((view) => (
                <MenuItem key={view.id} value={view.id}>
                  {view.label}
                </MenuItem>
              ))}
              {quickView === 'custom' && (
                <MenuItem value="custom" disabled>
                  Custom
                </MenuItem>
              )}
            </TextField>
          )}
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
            visibility={visibility}
            onVisibility={(model) => {
              setVisibility(model)
              customize()
            }}
            filters={filters}
            onPagination={setPagination}
            onSorting={(model) => {
              customize()
              setSorting(model)
              setPagination((previous) => ({ ...previous, page: 0 }))
            }}
            onFilters={(model) => {
              customize()
              setFilters(model)
              setPagination((previous) => ({ ...previous, page: 0 }))
            }}
            onAction={action}
          />
        )}
      </Paper>
      {merge && (
        <MergeIncidentDialog source={merge} onClose={() => setMerge(null)} onMerged={mergeSaved} />
      )}
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
      {confirmation && (
        <ConfirmDialog
          title={confirmationTitle}
          description={confirmationDescription}
          confirmDisabled={!confirmationReady}
          busy={busy}
          error={error}
          onClose={() => setConfirmation(null)}
          onConfirm={() => void confirm()}
        />
      )}
    </Stack>
  )
}
