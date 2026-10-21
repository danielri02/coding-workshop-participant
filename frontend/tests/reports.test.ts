import assert from 'node:assert/strict'
import { test } from 'node:test'
import { duration, reportQuery } from '../src/reports/query'
import { createQueryClient, invalidateResourceQueries } from '../src/services/queries'

test('timing queries preserve literal search, scope, page and milestone ordering', () => {
  const path = reportQuery(
    'timings',
    'personal',
    'seat',
    { page: 2, pageSize: 10 },
    [{ field: 'resolved_minutes', sort: 'asc' }],
    ' printer & 50% ',
  )
  const params = new URL(path, 'http://localhost').searchParams
  assert.equal(params.get('scope'), 'personal')
  assert.equal(params.get('search'), 'printer & 50%')
  assert.equal(params.get('page'), '2')
  assert.equal(params.get('page_size'), '10')
  assert.equal(params.get('sort_by'), 'resolved_minutes')
  assert.equal(params.get('sort_direction'), 'asc')
  assert.equal(params.has('level'), false)
  assert.equal(
    reportQuery('workload', 'personal', 'seat', { page: 2, pageSize: 10 }, [], 'ignored'),
    '/reports/workload',
  )
})

test('duration labels distinguish missing, immediate and sub-minute responses', () => {
  assert.equal(duration(null), 'Not recorded')
  assert.equal(duration(0), '0 min')
  assert.equal(duration(0.1), '<1 min')
  assert.equal(duration(90), '1.5 hr')
  assert.equal(duration(2880), '2.0 days')
})

test('CRUD changes invalidate cached report aggregates and engineer availability', async () => {
  const client = createQueryClient()
  try {
    const keys = [
      '/reports/workload',
      '/reports/summary?scope=personal',
      '/reports/summary?scope=assigned',
    ].map((path) => ['api', path])
    for (const key of keys) client.setQueryData(key, {})
    await invalidateResourceQueries(client, 'engineers')
    for (const key of keys) {
      assert.equal(client.getQueryState(key)?.isInvalidated, true)
      client.setQueryData(key, {})
    }
    await invalidateResourceQueries(client, 'incidents')
    for (const key of keys) assert.equal(client.getQueryState(key)?.isInvalidated, true)
  } finally {
    client.clear()
  }
})
