import type { GridColumnVisibilityModel, GridFilterModel, GridSortModel } from '@mui/x-data-grid'
import { incidentGrid } from '../generated/domain'

export const defaultIncidentColumns: GridColumnVisibilityModel = {
  id: false,
  merged_into_id: false,
  merged: false,
  category: false,
  building_id: false,
  blocked_reason: false,
  escalation_reason: false,
}

interface IncidentView {
  id: string
  label: string
  assignment?: 'unassigned' | 'assigned'
  filter?: GridFilterModel['items'][number]
  show?: 'blocked_reason' | 'escalation_reason' | 'merged_into_id'
}

export const incidentViews: IncidentView[] = [
  { id: 'all', label: 'All incidents' },
  {
    id: 'merged',
    label: 'Merged history',
    filter: { field: 'merged', operator: 'is', value: true },
    show: 'merged_into_id',
  },
  {
    id: 'unassigned',
    label: 'Unassigned',
    assignment: 'unassigned',
  },
  { id: 'with-assignee', label: 'Assigned', assignment: 'assigned' },
  {
    id: 'assigned',
    label: 'Awaiting acceptance',
    filter: { field: 'status', operator: 'is', value: 'Assigned' },
  },
  {
    id: 'blocked',
    label: 'Blocked',
    filter: { field: 'status', operator: 'is', value: 'Blocked' },
    show: 'blocked_reason',
  },
  {
    id: 'escalated',
    label: 'Escalated',
    filter: { field: 'escalated', operator: 'is', value: true },
    show: 'escalation_reason',
  },
  {
    id: 'resolved',
    label: 'Ready to close',
    filter: { field: 'status', operator: 'is', value: 'Resolved' },
  },
]

/** Apply a complete configuration so old searches and filters cannot hide its queue. */
export function incidentViewState(view: IncidentView) {
  return {
    assignment: view.assignment || 'all',
    filters: {
      items: view.filter ? [{ ...view.filter, id: 'quick-view' }] : [],
    } satisfies GridFilterModel,
    sorting: [{ ...incidentGrid.defaultSort }] satisfies GridSortModel,
    columns: { ...defaultIncidentColumns, ...(view.show ? { [view.show]: true } : {}) },
  }
}
