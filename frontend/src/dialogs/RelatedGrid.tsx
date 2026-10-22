import { useWorkspace } from '../hooks/useWorkspace'
import { useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Stack, TextField } from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import { useAuth } from '../auth/context'
import { DataTable } from '../components/DataTable'
import { RecordLink } from '../components/RecordLink'
import { ResourceGrid, type RowAction } from '../components/ResourceGrid'
import { useApiQuery, useDebouncedValue } from '../hooks/useApiQuery'
import { useLookups } from '../hooks/useLookups'
import { resources } from '../resources/definitions'
import { defaultGridSort, gridQuery } from '../resources/gridQuery'
import { decorateRow } from '../resources/rows'
import type { AdminRow, Incident, ResourcePageData } from '../types'
import { noteStatuses } from '../generated/domain'
import { invalidateResourceQueries } from '../services/queries'
import { useRecordDialogs } from './context'
import type { CollectionTarget, DialogEntry } from './navigation'

/** Browse one relationship with the same columns and API scopes as its full grid. */
export function RelatedGrid({
  target,
  state,
  onAction,
}: {
  target: CollectionTarget
  state: DialogEntry['state']
  onAction: (action: RowAction | 'create', row: AdminRow) => void
}) {
  const { user } = useAuth()
  const { adminView, workspace } = useWorkspace()
  const client = useQueryClient()
  const { setState } = useRecordDialogs()
  const resource = resources.find((item) => item.key === target.resource)!
  const lookups = useLookups({
    lookups: resource.lookups.filter((key) => key !== 'users' || adminView),
  })
  const search = useDebouncedValue(state.search)
  const pagination = { page: state.page, pageSize: state.pageSize }
  const sorting = [{ field: state.sortField, sort: state.sortDirection }]
  const parent = useApiQuery<Incident | null>(
    target.resource === 'notes' ? `/incidents/${target.filters.incident_id}` : null,
    null,
  )
  const path = gridQuery(resource, pagination, sorting, state.filters, search, {
    ...target.filters,
    ...(!adminView && user && resource.key === 'incidents'
      ? workspace?.id === 'assigned'
        ? { assignee_id: user.id }
        : { reporter_id: user.id }
      : {}),
  })
  const query = useApiQuery<ResourcePageData>(path, {
    rows: [],
    row_count: 0,
    page: 0,
    page_size: 25,
  })
  const columns = useMemo(() => resource.columns(lookups.data), [resource, lookups.data])
  const rows = query.data.rows.map((row) => decorateRow(resource.key, row, lookups.data))
  const loading = query.loading || lookups.loading || search !== state.search
  const error = query.error || lookups.error || parent.error
  const canPostNote =
    adminView ||
    (workspace?.id === 'assigned' &&
      Boolean(user?.engineer_profile) &&
      parent.data?.assignee_id === user?.id)
  const canAddNote =
    canPostNote && parent.data && noteStatuses.some((status) => status === parent.data?.status)
  const readColumns: GridColDef<AdminRow>[] = [
    {
      field: 'id',
      headerName: 'ID',
      width: 85,
      filterable: false,
      renderCell: ({ row, hasFocus }) => (
        <RecordLink
          resource={resource.key}
          id={row.id}
          tabIndex={hasFocus ? 0 : -1}
        >{`#${row.id}`}</RecordLink>
      ),
    },
    ...columns,
  ]
  return (
    <Stack spacing={2} sx={{ minWidth: 0 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField
          label={`Search ${resource.title.toLowerCase()}`}
          size="small"
          value={state.search}
          onChange={(event) => setState({ search: event.target.value, page: 0 })}
          slotProps={{ htmlInput: { maxLength: 200 } }}
        />
        {target.resource === 'notes' && canPostNote && (
          <Button
            disabled={!canAddNote || Boolean(error)}
            onClick={() => onAction('create', { id: 0 })}
          >
            New note
          </Button>
        )}
        <Button
          disabled={loading}
          onClick={() =>
            void invalidateResourceQueries(
              client,
              resource.key,
              target.resource === 'notes' ? ['incidents'] : resource.lookups,
            )
          }
        >
          Refresh
        </Button>
      </Stack>
      {parent.data?.status === 'Closed' && (
        <Alert severity="info">
          This incident is closed.{' '}
          {adminView
            ? 'Existing notes can be read, corrected or deleted.'
            : 'Existing notes remain available to read.'}
        </Alert>
      )}
      {error ? (
        <Alert severity="error">{error}</Alert>
      ) : adminView ? (
        <ResourceGrid
          resource={resource.key}
          rows={rows}
          columns={columns}
          loading={loading}
          disabled={loading}
          rowCount={query.data.row_count}
          pagination={pagination}
          sorting={sorting}
          filters={state.filters}
          onPagination={(model) => setState({ page: model.page, pageSize: model.pageSize })}
          onSorting={(model) =>
            setState({
              sortField: model[0]?.field || defaultGridSort(resource.key).field,
              sortDirection: model[0]?.sort || defaultGridSort(resource.key).sort,
              page: 0,
            })
          }
          onFilters={(model) => setState({ filters: model, page: 0 })}
          onAction={onAction}
        />
      ) : (
        <DataTable
          rows={rows}
          columns={readColumns}
          loading={loading}
          rowCount={query.data.row_count}
          paginationMode="server"
          sortingMode="server"
          filterMode="server"
          paginationModel={pagination}
          onPaginationModelChange={(model) =>
            setState({ page: model.page, pageSize: model.pageSize })
          }
          sortModel={sorting}
          onSortModelChange={(model) =>
            setState({
              sortField: model[0]?.field || defaultGridSort(resource.key).field,
              sortDirection: model[0]?.sort || defaultGridSort(resource.key).sort,
              page: 0,
            })
          }
          filterModel={state.filters}
          onFilterModelChange={(model) => setState({ filters: model, page: 0 })}
        />
      )}
    </Stack>
  )
}
