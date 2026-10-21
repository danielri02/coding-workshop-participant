import { useCallback, useMemo, useState } from 'react'
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
import { useNavigate, useOutletContext, useSearchParams } from 'react-router-dom'
import PropTypes from 'prop-types'
import { useAuth } from '../auth/context'
import type { AdminOutlet } from '../components/AdminLayout'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { RecordDetailsDialog } from '../components/RecordDetailsDialog'
import { RecordFormDialog } from '../components/RecordFormDialog'
import { ResourceGrid, type RowAction } from '../components/ResourceGrid'
import { useApiQuery, useDebouncedValue } from '../hooks/useApiQuery'
import { useLookups } from '../hooks/useLookups'
import {
  decorateRow,
  priorities,
  transitions,
  type Field,
  type ResourceDefinition,
} from '../resources/definitions'
import { api, errorMessage } from '../services/client'
import type { AdminRow, IncidentPage, User } from '../types'

function incidentQuery(
  pagination: GridPaginationModel,
  sorting: GridSortModel,
  filters: GridFilterModel,
  search: string,
): string {
  const sort = sorting[0]
  const params = new URLSearchParams({
    page: String(pagination.page),
    page_size: String(pagination.pageSize),
    sort_by: sort?.field === 'assignee_id' ? 'assignee_name' : sort?.field || 'id',
    sort_direction: sort?.sort || 'asc',
  })
  if (search.trim()) params.set('search', search.trim())
  const allowed = [
    'reporter_id',
    'assignee_id',
    'building_id',
    'floor_id',
    'seat_id',
    'status',
    'priority',
    'category',
    'escalated',
  ]
  for (const item of filters.items) {
    if (allowed.includes(item.field) && item.value !== undefined && item.value !== '')
      params.set(item.field, String(item.value))
  }
  return `/incidents/grid?${params}`
}

type Editor = {
  action: 'create' | 'edit' | 'assignment' | 'priority' | 'status'
  row: AdminRow | null
}

/** Connect resource metadata to reusable CRUD forms, grids and backend operations. */
export function ResourcePage({ resource }: { resource: ResourceDefinition }) {
  const { revision, changed } = useOutletContext<AdminOutlet>()
  const { user, setAccount, logout } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const scope = Number(searchParams.get('incident')) || 0
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search)
  const [pagination, setPagination] = useState<GridPaginationModel>({ page: 0, pageSize: 25 })
  const [sorting, setSorting] = useState<GridSortModel>([{ field: 'id', sort: 'asc' }])
  const [filters, setFilters] = useState<GridFilterModel>({ items: [] })
  const [editor, setEditor] = useState<Editor | null>(null)
  const [viewing, setViewing] = useState<AdminRow | null>(null)
  const [confirmation, setConfirmation] = useState<{
    action: 'delete' | 'admin'
    row: AdminRow
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lookups = useLookups(resource, revision)
  const incidents = useApiQuery<AdminRow[]>(
    resource.key === 'notes' ? '/incidents' : null,
    [],
    revision,
  )
  const selectedIncident = incidents.data.find((row) => row.id === scope)
  const server = resource.key === 'incidents'
  const path = server
    ? incidentQuery(pagination, sorting, filters, debouncedSearch)
    : resource.key === 'notes'
      ? scope
        ? `/incidents/${scope}/notes`
        : null
      : resource.endpoint
  const query = useApiQuery<AdminRow[] | IncidentPage>(path, [], revision)
  const rows = (Array.isArray(query.data) ? query.data : query.data.rows).map((row) =>
    decorateRow(resource.key, row, lookups.data),
  )
  const rowCount = Array.isArray(query.data) ? 0 : query.data.row_count
  const loading =
    query.loading || lookups.loading || incidents.loading || (server && search !== debouncedSearch)
  const failure = query.error || lookups.error || incidents.error
  const columns = useMemo(() => resource.columns(lookups.data), [resource, lookups.data])
  const activeNotes = ['Open', 'In Progress', 'Blocked'].includes(String(selectedIncident?.status))
  const title = resource.singular[0].toUpperCase() + resource.singular.slice(1)

  const action = useCallback(
    (command: RowAction, row: AdminRow) => {
      setError('')
      if (command === 'notes') navigate(`/admin/notes?incident=${row.id}`)
      else if (command === 'view') setViewing(row)
      else if (command === 'delete' || command === 'admin')
        setConfirmation({ action: command, row })
      else setEditor({ action: command, row })
    },
    [navigate],
  )

  const save = async (payload: Record<string, unknown>) => {
    if (!editor) return
    const creating = editor.action === 'create'
    const suffix = ['assignment', 'priority', 'status'].includes(editor.action)
      ? `/${editor.action}`
      : ''
    const endpoint = creating
      ? resource.key === 'notes'
        ? `/incidents/${scope}/notes`
        : resource.endpoint
      : `${resource.endpoint}/${editor.row?.id}${suffix}`
    const saved = await api<AdminRow>(endpoint, {
      method: creating ? 'POST' : 'PATCH',
      body: JSON.stringify(payload),
    })
    if (resource.key === 'users' && saved.id === user?.id) setAccount(saved as unknown as User)
    setEditor(null)
    changed(`${title} ${creating ? 'created' : 'updated'}.`)
  }

  const confirm = async () => {
    if (!confirmation) return
    setBusy(true)
    setError('')
    try {
      const { row, action: command } = confirmation
      const saved = await api<User>(
        `${resource.endpoint}/${row.id}${command === 'admin' ? '/admin' : ''}`,
        {
          method: command === 'delete' ? 'DELETE' : 'PATCH',
          ...(command === 'admin' ? { body: JSON.stringify({ is_admin: !row.is_admin }) } : {}),
        },
      )
      setConfirmation(null)
      changed(command === 'delete' ? `${title} deleted.` : 'Admin access updated.')
      if (resource.key === 'users' && row.id === user?.id) {
        if (command === 'delete') await logout()
        else setAccount(saved)
      }
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setBusy(false)
    }
  }

  let fields: Field[] = resource.fields
  let formRow = editor?.row || null
  if (editor?.action === 'assignment')
    fields = [
      {
        name: 'assignee_id',
        label: 'Assigned engineer',
        type: 'select',
        numeric: true,
        helper: 'Choose None to leave this incident unassigned.',
        options: (data) =>
          data.users
            .filter((row) => row.engineer_profile)
            .map((row) => ({ value: row.id, label: String(row.name) })),
      },
    ]
  if (editor?.action === 'priority')
    fields = [
      {
        name: 'priority',
        label: 'Priority',
        type: 'select',
        required: true,
        options: () => priorities.map((value) => ({ value, label: value })),
      },
      {
        name: 'escalation_reason',
        label: 'Escalation reason',
        type: 'multiline',
        maxLength: 2000,
        helper: 'A reason marks this incident as escalated. Clear it to remove escalation.',
      },
    ]
  if (editor?.action === 'status') {
    const next = transitions[String(editor.row?.status)] || []
    fields = [
      {
        name: 'status',
        label: 'Next status',
        type: 'select',
        required: true,
        options: () => next.map((value) => ({ value, label: value })),
      },
      {
        name: 'blocked_reason',
        label: 'Blocked reason',
        type: 'multiline',
        maxLength: 2000,
        when: (values) => values.status === 'Blocked',
        requiredWhen: (values) => values.status === 'Blocked',
      },
    ]
    formRow = editor.row ? { ...editor.row, status: '', blocked_reason: '' } : null
  }
  const formTitle =
    editor?.action === 'create'
      ? `New ${resource.singular}`
      : editor?.action === 'edit'
        ? `Edit ${resource.singular}`
        : editor?.action === 'assignment'
          ? 'Assign engineer'
          : editor?.action === 'priority'
            ? 'Priority and escalation'
            : 'Change status'

  return (
    <Stack spacing={3}>
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
      <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
        <Stack
          direction="row"
          sx={{
            p: 2,
            borderBottom: '1px solid',
            borderColor: 'divider',
            alignItems: 'center',
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
              htmlInput: { maxLength: server ? 200 : undefined },
            }}
            sx={{ width: { xs: '100%', sm: 360 } }}
          />
          <Button
            startIcon={<Refresh />}
            onClick={() => changed('Reloading records…')}
            disabled={loading}
            sx={{ ml: 'auto' }}
          >
            Refresh
          </Button>
        </Stack>
        {resource.key === 'notes' && !scope ? (
          <Box sx={{ p: 8, textAlign: 'center' }}>
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
