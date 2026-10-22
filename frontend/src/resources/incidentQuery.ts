import { incidentGrid } from '../generated/domain'
import type { GridFilterModel, GridPaginationModel, GridSortModel } from '@mui/x-data-grid'

/** Translate controlled grid state into the scoped incident collection query. */
export function incidentQuery(
  pagination: GridPaginationModel,
  sorting: GridSortModel,
  filters: GridFilterModel,
  search: string,
  scope: {
    reporter_id?: number
    assignee_id?: number
    building_id?: number
    floor_id?: number
    seat_id?: number
    unassigned?: boolean
  } = {},
): string {
  const sort = sorting[0]
  const params = new URLSearchParams({
    page: String(pagination.page),
    page_size: String(pagination.pageSize),
    sort_by:
      sort?.field === 'assignee_id'
        ? 'assignee_name'
        : sort?.field || incidentGrid.defaultSort.field,
    sort_direction: sort?.sort || incidentGrid.defaultSort.sort,
  })
  if (search.trim()) params.set('search', search.trim())
  for (const item of filters.items) {
    if (
      incidentGrid.filterFields.some((field) => field === item.field) &&
      item.value !== undefined &&
      item.value !== null &&
      item.value !== ''
    )
      params.set(item.field, String(item.value))
  }
  for (const [field, value] of Object.entries(scope))
    if (value !== undefined) params.set(field, String(value))
  return `/incidents/grid?${params}`
}
