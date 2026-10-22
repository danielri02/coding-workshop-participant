import type { ResourceKey } from '../types'
import { defaultGridSort } from '../resources/gridQuery'
import type { IncidentScope } from '../incidents/scope'
import type { GridFilterModel } from '@mui/x-data-grid'

export interface RelatedFilters {
  incident_id?: number
  assignee_id?: number
  reporter_id?: number
  building_id?: number
  floor_id?: number
  seat_id?: number
}

export type RecordTarget = {
  kind: 'record'
  resource: ResourceKey
  id: number
  label?: string
  scope?: IncidentScope
}
export type CollectionTarget = {
  kind: 'collection'
  resource: ResourceKey
  filters: RelatedFilters
  title: string
}
export type DialogTarget = RecordTarget | CollectionTarget

/** History stores content and grid state, never additional open dialogs. */
export interface DialogEntry {
  target: DialogTarget
  state: {
    search: string
    page: number
    pageSize: number
    sortField: string
    sortDirection: 'asc' | 'desc'
    filters: GridFilterModel
  }
}

export function dialogEntry(target: DialogTarget): DialogEntry {
  return {
    target,
    state: {
      search: '',
      page: 0,
      pageSize: 25,
      sortField: defaultGridSort(target.resource).field,
      sortDirection: defaultGridSort(target.resource).sort,
      filters: { items: [] },
    },
  }
}

export function targetKey(target: DialogTarget): string {
  return target.kind === 'record'
    ? `${target.resource}:${target.id}`
    : `${target.resource}:${JSON.stringify(target.filters)}`
}
