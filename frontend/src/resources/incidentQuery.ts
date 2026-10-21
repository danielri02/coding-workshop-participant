import { incidentGrid } from '../generated/domain'
import type { GridFilterModel, GridPaginationModel, GridSortModel } from '@mui/x-data-grid'

/** Translate controlled grid state into the scoped incident collection query. */
export function incidentQuery(
  pagination: GridPaginationModel,
  sorting: GridSortModel,
  filters: GridFilterModel,
  search: string,
  reporterId?: number,
): string {
  const sort = sorting[0]
  const params = new URLSearchParams({
    page: String(pagination.page),
    page_size: String(pagination.pageSize),
    sort_by: sort?.field === 'assignee_id' ? 'assignee_name' : sort?.field || 'id',
    sort_direction: sort?.sort || 'asc',
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
  if (reporterId !== undefined) params.set('reporter_id', String(reporterId))
  return `/incidents/grid?${params}`
}
