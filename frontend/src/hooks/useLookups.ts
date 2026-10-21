import { useMemo } from 'react'
import type { ResourceDefinition } from '../resources/definitions'
import type { User, Building, Floor, Seat, Lookups } from '../types'
import { useApiQuery } from './useApiQuery'

/** Load only the relationship tables required by the current resource. */
export function useLookups(resource: Pick<ResourceDefinition, 'lookups'>) {
  const users = useApiQuery<User[]>(resource.lookups.includes('users') ? '/users' : null, [])
  const buildings = useApiQuery<Building[]>(
    resource.lookups.includes('buildings') ? '/buildings' : null,
    [],
  )
  const floors = useApiQuery<Floor[]>(resource.lookups.includes('floors') ? '/floors' : null, [])
  const seats = useApiQuery<Seat[]>(resource.lookups.includes('seats') ? '/seats' : null, [])
  const data: Lookups = useMemo(
    () => ({
      users: users.data,
      buildings: buildings.data,
      floors: floors.data,
      seats: seats.data,
    }),
    [users.data, buildings.data, floors.data, seats.data],
  )
  return {
    data,
    loading: [users, buildings, floors, seats].some((query) => query.loading),
    error: [users, buildings, floors, seats].find((query) => query.error)?.error || '',
  }
}
