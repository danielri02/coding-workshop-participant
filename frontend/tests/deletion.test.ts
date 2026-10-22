import { expect, test } from 'vitest'
import { deletionWarning } from '../src/resources/deletion'
import { createQueryClient, invalidateResourceQueries } from '../src/services/queries'

test('deletion warnings include affected content, preserved assignments and account access', () => {
  const warning = deletionWarning({
    resource: 'users',
    record_id: 7,
    confirmation_token: 'a'.repeat(64),
    counts: { users: 1, engineers: 1, incidents: 3, notes: 5 },
    unassigned_incidents: 2,
  })
  expect(warning).toContain('1 user account, 1 engineer profile, 3 incidents, 5 notes')
  expect(warning).toContain('2 assigned incidents will be preserved and unassigned')
  expect(warning).toContain('resolved and closed incidents keep their status')
  expect(warning).toContain('sessions will be revoked')
  expect(warning).toContain('cannot be undone')
  expect(
    deletionWarning({
      resource: 'notes',
      record_id: 1,
      counts: { notes: 1 },
      unassigned_incidents: 0,
      confirmation_token: '',
    }),
  ).not.toContain('unassigned')
})

test.each([
  ['buildings', ['buildings', 'floors', 'seats', 'incidents', 'notes']],
  ['floors', ['floors', 'seats', 'incidents', 'notes']],
  ['seats', ['seats', 'incidents', 'notes']],
  ['engineers', ['engineer-profiles', 'users', 'incidents']],
  ['users', ['users', 'engineer-profiles', 'incidents', 'notes']],
] as const)(
  'a %s cascade invalidates affected grids, detail dialogs, reports and previews',
  async (resource, domains) => {
    const client = createQueryClient()
    try {
      const paths = [
        ...domains.map((domain) => `/${domain}/7`),
        '/incidents/grid?page=1',
        '/reports/workload',
        '/deletions/buildings/7',
      ]
      for (const path of paths) client.setQueryData(['api', path], {})
      await invalidateResourceQueries(client, resource)
      for (const path of paths)
        expect(client.getQueryState(['api', path])?.isInvalidated).toBe(true)
    } finally {
      client.clear()
    }
  },
)
