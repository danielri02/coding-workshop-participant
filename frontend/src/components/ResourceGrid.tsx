import { useState } from 'react'
import { Box, IconButton, Menu, MenuItem, Tooltip } from '@mui/material'
import DeleteOutlined from '@mui/icons-material/DeleteOutlined'
import EditOutlined from '@mui/icons-material/EditOutlined'
import MoreHoriz from '@mui/icons-material/MoreHoriz'
import VisibilityOutlined from '@mui/icons-material/VisibilityOutlined'
import {
  type GridColDef,
  type GridColumnVisibilityModel,
  type GridFilterModel,
  type GridPaginationModel,
  type GridSortModel,
} from '@mui/x-data-grid'
import { DataTable } from './DataTable'
import { RecordLink } from './RecordLink'
import type { AdminRow, ResourceKey } from '../types'
import { incidentCommands } from '../resources/incidentActions'
import { defaultIncidentColumns } from '../resources/incidentViews'

export type RowAction =
  | 'view'
  | 'edit'
  | 'delete'
  | 'admin'
  | 'assignment'
  | 'priority'
  | 'status'
  | 'notes'
  | 'merge'
  | 'reattach'
interface ActionsProps {
  row: AdminRow
  resource: ResourceKey
  disabled: boolean
  onAction: (action: RowAction, row: AdminRow) => void
}

/** Keep common row controls and resource-specific commands in one accessible menu. */
function RowActions({ row, resource, disabled, onAction }: ActionsProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const extras: { action: RowAction; label: string }[] =
    resource === 'users'
      ? [{ action: 'admin', label: row.is_admin ? 'Remove admin access' : 'Grant admin access' }]
      : resource === 'incidents'
        ? [
            ...(row.merged_into_id ? [] : incidentCommands()),
            { action: 'notes', label: 'View notes' },
          ]
        : resource === 'tickets'
          ? [{ action: 'reattach', label: 'Reattach ticket' }]
          : []
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
      {(
        [
          { action: 'view', label: 'View', icon: <VisibilityOutlined fontSize="small" /> },
          ...(resource === 'tickets' || row.merged_into_id
            ? []
            : [
                { action: 'edit' as const, label: 'Edit', icon: <EditOutlined fontSize="small" /> },
              ]),
          ...(resource === 'tickets'
            ? []
            : [
                {
                  action: 'delete' as const,
                  label: 'Delete',
                  icon: <DeleteOutlined fontSize="small" />,
                },
              ]),
        ] as const
      ).map((item) => (
        <Tooltip title={item.label} key={item.action}>
          <span>
            <IconButton
              size="small"
              disabled={disabled}
              aria-label={`${item.label} ${resource} ${row.id}`}
              onClick={() => onAction(item.action, row)}
              color={item.action === 'delete' ? 'error' : 'default'}
            >
              {item.icon}
            </IconButton>
          </span>
        </Tooltip>
      ))}
      {extras.length > 0 && (
        <>
          <IconButton
            size="small"
            disabled={disabled}
            aria-label={`More actions for ${resource} ${row.id}`}
            onClick={(event) => setAnchor(event.currentTarget)}
          >
            <MoreHoriz fontSize="small" />
          </IconButton>
          <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
            {extras.map((item) => (
              <MenuItem
                key={item.action}
                onClick={() => {
                  setAnchor(null)
                  onAction(item.action, row)
                }}
              >
                {item.label}
              </MenuItem>
            ))}
          </Menu>
        </>
      )}
    </Box>
  )
}

interface GridProps {
  resource: ResourceKey
  rows: AdminRow[]
  columns: GridColDef<AdminRow>[]
  loading: boolean
  disabled: boolean
  rowCount?: number
  pagination: GridPaginationModel
  sorting: GridSortModel
  filters: GridFilterModel
  visibility?: GridColumnVisibilityModel
  onVisibility?: (model: GridColumnVisibilityModel) => void
  onPagination: (model: GridPaginationModel) => void
  onSorting: (model: GridSortModel) => void
  onFilters: (model: GridFilterModel) => void
  onAction: (action: RowAction, row: AdminRow) => void
}

/** Every CRUD collection uses backend paging, sorting and filtering. */
export function ResourceGrid({
  resource,
  rows,
  columns,
  loading,
  disabled,
  rowCount,
  pagination,
  sorting,
  filters,
  visibility,
  onVisibility,
  onPagination,
  onSorting,
  onFilters,
  onAction,
}: GridProps) {
  const isIncident = resource === 'incidents'
  const allColumns: GridColDef<AdminRow>[] = [
    {
      field: 'id',
      headerName: 'ID',
      width: 85,
      filterable: false,
      renderCell: ({ row, hasFocus }) => (
        <RecordLink
          resource={resource}
          id={row.id}
          tabIndex={hasFocus ? 0 : -1}
        >{`#${row.id}`}</RecordLink>
      ),
    },
    ...columns,
    {
      field: 'actions',
      headerName: 'Actions',
      width: resource === 'incidents' || resource === 'users' ? 155 : 120,
      sortable: false,
      filterable: false,
      disableColumnMenu: true,
      renderCell: ({ row }) => (
        <RowActions row={row} resource={resource} disabled={disabled} onAction={onAction} />
      ),
    },
  ]
  return (
    <DataTable
      rows={rows}
      columns={allColumns}
      loading={loading}
      initialState={{
        columns: {
          columnVisibilityModel: isIncident ? defaultIncidentColumns : {},
        },
      }}
      rowCount={rowCount}
      paginationMode="server"
      sortingMode="server"
      filterMode="server"
      paginationModel={pagination}
      onPaginationModelChange={onPagination}
      sortModel={sorting}
      onSortModelChange={onSorting}
      filterModel={filters}
      onFilterModelChange={onFilters}
      columnVisibilityModel={isIncident ? visibility : undefined}
      onColumnVisibilityModelChange={isIncident ? onVisibility : undefined}
    />
  )
}
