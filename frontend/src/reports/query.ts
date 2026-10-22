import type { GridPaginationModel, GridSortModel } from '@mui/x-data-grid'
import type { ApiSchemas } from '../types'
import type { ReportKey } from './definitions'

export type Period = ApiSchemas['ReportPeriod']
export const periods: { value: Period; label: string }[] = [
  { value: 'week', label: 'Last 7 days' },
  { value: 'month', label: 'Last 30 days' },
  { value: 'year', label: 'Last 12 months' },
  { value: 'all', label: 'All time' },
]
export interface ReportFilters {
  period: Period
  category?: string
  assignee_id?: string
  building_id?: string
  floor_id?: string
  seat_id?: string
}

export type Scope = ApiSchemas['ReportScope']
export type LocationLevel = ApiSchemas['LocationReport']['level']
export type Report =
  | ApiSchemas['LocationReport']
  | ApiSchemas['TimingReport']
  | ApiSchemas['WorkloadReport']
  | ApiSchemas['CategoryReport']

/** Encode the same scoped query for timing summaries and their paginated rows. */
export function reportQuery(
  key: ReportKey,
  scope: Scope,
  level: LocationLevel,
  pagination: GridPaginationModel,
  sorting: GridSortModel,
  search: string,
  filters: ReportFilters = { period: 'month' },
): string {
  const params = new URLSearchParams()
  if (key !== 'workload') {
    params.set('scope', scope)
    params.set('period', filters.period)
  }
  const fields =
    key === 'categories'
      ? ['building_id', 'floor_id', 'seat_id']
      : key === 'locations'
        ? ['category']
        : key === 'timings'
          ? ['category', 'assignee_id']
          : []
  for (const field of fields) {
    const value = filters[field as keyof ReportFilters]
    if (value) params.set(field, value)
  }
  if (key === 'locations') params.set('level', level)
  if (key === 'timings') {
    params.set('page', String(pagination.page))
    params.set('page_size', String(pagination.pageSize))
    params.set('sort_by', sorting[0]?.field || 'created_at')
    params.set('sort_direction', sorting[0]?.sort || 'desc')
    if (search.trim()) params.set('search', search.trim())
  }
  return `/reports/${key}${params.size ? `?${params}` : ''}`
}

/** Keep absent milestones distinct from a recorded immediate response. */
export function duration(minutes: number | null | undefined): string {
  if (minutes == null) return 'Not recorded'
  if (minutes === 0) return '0 min'
  if (minutes < 1) return '<1 min'
  if (minutes < 60) return `${minutes.toFixed(1)} min`
  if (minutes < 1440) return `${(minutes / 60).toFixed(1)} hr`
  return `${(minutes / 1440).toFixed(1)} days`
}
