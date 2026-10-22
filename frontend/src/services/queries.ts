import { QueryClient } from '@tanstack/react-query'
import type { ResourceKey } from '../types'

/** Share successful reads briefly; mutations retry only when the user requests it. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: 30000, retry: false, refetchOnWindowFocus: false } },
  })
}

const dependencies: Record<ResourceKey, string[]> = {
  tickets: ['tickets', 'incidents', 'notes'],
  users: ['tickets', 'users', 'engineer-profiles', 'incidents', 'notes'],
  engineers: ['engineer-profiles', 'users', 'incidents', 'tickets'],
  buildings: ['buildings', 'floors', 'seats', 'incidents', 'tickets', 'notes'],
  floors: ['floors', 'seats', 'incidents', 'tickets', 'notes'],
  seats: ['seats', 'incidents', 'tickets', 'notes'],
  incidents: ['incidents', 'tickets', 'notes'],
  notes: ['notes'],
}

/** Refresh affected collections/details and their displayed relationship names. */
export function invalidateResourceQueries(
  client: QueryClient,
  resource: ResourceKey,
  related: readonly ResourceKey[] = [],
): Promise<void> {
  const affected = [
    'reports',
    'deletions',
    ...dependencies[resource],
    ...related.map((key) => (key === 'engineers' ? 'engineer-profiles' : key)),
  ]
  return client.invalidateQueries({
    predicate: (query) => {
      const [namespace, path] = query.queryKey
      if (namespace !== 'api' || typeof path !== 'string') return false
      const route = path.split('?')[0]
      const domain =
        route.endsWith('/notes') || route.endsWith('/notes/grid') ? 'notes' : route.split('/')[1]
      return affected.includes(domain)
    },
  })
}
