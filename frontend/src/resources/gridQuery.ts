import type { GridFilterModel, GridPaginationModel, GridSortModel } from '@mui/x-data-grid'
import type { RelatedFilters } from '../dialogs/navigation'
import type { ResourceDefinition } from './definitions'
import type { ResourceKey } from '../types'
import { incidentGrid } from '../generated/domain'
import { incidentQuery } from './incidentQuery'

/** Pages, related dialogs and cleared sort controls share the same defaults. */
export function defaultGridSort(resource: ResourceKey) {
  if (resource === 'incidents' || resource === 'tickets') return incidentGrid.defaultSort
  if (resource === 'notes') return { field: 'created_at', sort: 'desc' } as const
  return { field: 'id', sort: 'asc' } as const
}

/** All CRUD grids use the same page envelope; lookups keep their list endpoints. */
export function gridQuery(
  resource: Pick<ResourceDefinition, 'key' | 'endpoint'>,
  pagination: GridPaginationModel,
  sorting: GridSortModel,
  filters: GridFilterModel,
  search: string,
  scope: RelatedFilters & { unassigned?: boolean } = {},
): string | null {
  if (resource.key === 'tickets') {
    const { incident_id, ...ticketScope } = scope
    const path = incidentQuery(pagination, sorting, filters, search, ticketScope).replace(
      '/incidents/grid',
      '/tickets/grid',
    )
    return incident_id ? `${path}&incident_id=${incident_id}` : path
  }
  if (resource.key === 'incidents')
    return incidentQuery(pagination, sorting, filters, search, scope)
  if (resource.key === 'notes' && !scope.incident_id) return null
  const sort = sorting[0]
  const params = new URLSearchParams({
    page: String(pagination.page),
    page_size: String(pagination.pageSize),
    sort_by: sort?.field || defaultGridSort(resource.key).field,
    sort_direction: sort?.sort || defaultGridSort(resource.key).sort,
  })
  if (search.trim()) params.set('search', search.trim())
  // The community Data Grid has one column filter. Incomplete editors send no value.
  const filter = filters.items[0]
  if (filter) {
    params.set('filter_field', filter.field)
    params.set('filter_operator', filter.operator)
    const value: unknown = filter.value
    if (Array.isArray(value)) {
      for (const item of value) params.append('filter_values', String(item))
    } else if (value !== undefined && value !== null && value !== '') {
      const date = filter.field === 'created_at' ? new Date(String(value)) : null
      if (!date || !Number.isNaN(date.getTime()))
        params.set('filter_value', date ? date.toISOString() : String(value))
    }
  }
  if (resource.key === 'floors' && scope.building_id)
    params.set('building_id', String(scope.building_id))
  if (resource.key === 'seats' && scope.floor_id) params.set('floor_id', String(scope.floor_id))
  const endpoint =
    resource.key === 'notes' ? `/incidents/${scope.incident_id}/notes` : resource.endpoint
  return `${endpoint}/grid?${params}`
}
