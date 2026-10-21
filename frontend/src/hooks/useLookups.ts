import { useMemo } from 'react'
import type { ResourceDefinition } from '../resources/definitions'
import type { AdminRow, Lookups } from '../types'
import { useApiQuery } from './useApiQuery'

/** Load only the relationship tables required by the current resource. */
export function useLookups(resource: ResourceDefinition, revision: number) {
  const users = useApiQuery<AdminRow[]>(
    resource.lookups.includes('users') ? '/users' : null,
    [],
    revision,
  )
  const buildings = useApiQuery<AdminRow[]>(
    resource.lookups.includes('buildings') ? '/buildings' : null,
    [],
    revision,
  )
  const floors = useApiQuery<AdminRow[]>(
    resource.lookups.includes('floors') ? '/floors' : null,
    [],
    revision,
  )
  const seats = useApiQuery<AdminRow[]>(
    resource.lookups.includes('seats') ? '/seats' : null,
    [],
    revision,
  )
  const data: Lookups = useMemo(
    () => ({
      users: users.data,
      buildings: buildings.data,
      floors: floors.data,
      seats: seats.data,
      engineers: [],
    }),
    [users.data, buildings.data, floors.data, seats.data],
  )
  return {
    data,
    loading: [users, buildings, floors, seats].some((query) => query.loading),
    error: [users, buildings, floors, seats].find((query) => query.error)?.error || '',
  }
}
