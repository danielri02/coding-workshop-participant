import { QueryClient } from '@tanstack/react-query'
import type { ResourceKey } from '../types'

/** Share successful reads briefly; mutations retry only when the user requests it. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: 30000, retry: false, refetchOnWindowFocus: false } },
  })
}

const dependencies: Record<ResourceKey, string[]> = {
  users: ['users', 'engineer-profiles', 'incidents', 'notes'],
  engineers: ['engineer-profiles', 'users', 'incidents'],
  buildings: ['buildings', 'floors', 'seats', 'incidents', 'notes'],
  floors: ['floors', 'seats', 'incidents', 'notes'],
  seats: ['seats', 'incidents', 'notes'],
  incidents: ['incidents', 'notes'],
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
      const domain = route.endsWith('/notes') ? 'notes' : route.split('/')[1]
      return affected.includes(domain)
    },
  })
}
