import type { AdminRow, ApiRecord, Lookups, ResourceKey } from '../types'

/** Find a human-readable label for a related record. */
export function recordLabel(rows: AdminRow[], id: unknown, field: keyof AdminRow = 'name'): string {
  if (id === null || id === undefined || id === '') return '—'
  const row = rows.find((item) => item.id === Number(id))
  return row ? String(row[field] ?? row.id) : `#${String(id)}`
}

/** Label floors with their building so duplicate floor labels remain distinct. */
export function floorLabel(lookups: Lookups, id: unknown): string {
  const floor = lookups.floors.find((row) => row.id === Number(id))
  return floor
    ? `${recordLabel(lookups.buildings, floor.building_id)} · Floor ${String(floor.label)}`
    : '—'
}

/** Normalize API rows and add display-only relationship labels for local grids. */
export function decorateRow(
  key: ResourceKey,
  row: ApiRecord | AdminRow,
  lookups: Lookups,
): AdminRow {
  const record: AdminRow = { ...row, id: 'id' in row ? row.id : row.user_id }
  return {
    ...record,
    ...(key === 'users' ? { is_engineer: Boolean(record.engineer_profile) } : {}),
    ...(key === 'engineers'
      ? {
          user_name: recordLabel(lookups.users, record.user_id),
          user_email: recordLabel(lookups.users, record.user_id, 'email'),
        }
      : {}),
    ...(key === 'floors'
      ? { building_name: recordLabel(lookups.buildings, record.building_id) }
      : {}),
    ...(key === 'seats' ? { floor_name: floorLabel(lookups, record.floor_id) } : {}),
    ...(key === 'incidents' ? { escalated: Boolean(record.escalation_reason) } : {}),
  }
}
