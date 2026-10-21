import assert from 'node:assert/strict'
import { test } from 'node:test'
import { incidentQuery } from '../src/resources/incidentQuery'
import { formPayload, type Field } from '../src/resources/forms'
import { decorateRow } from '../src/resources/rows'
import { transitions } from '../src/generated/domain'
import { createQueryClient, invalidateResourceQueries } from '../src/services/queries'
import type { Lookups, EngineerProfile } from '../src/types'

const empty: Lookups = { users: [], buildings: [], floors: [], seats: [] }

test('engineer transport IDs are normalized only at the presentation boundary', () => {
  const profile: EngineerProfile = { user_id: 42, is_available: false }
  const row = decorateRow('engineers', profile, empty)
  assert.equal(row.id, 42)
  assert.equal(row.is_available, false)
  assert.equal('id' in profile, false)
})

test('PATCH payloads distinguish clearing, unchanged fields and immutable parents', () => {
  const fields: Field[] = [
    { name: 'building_id', numeric: true, immutable: true, label: 'Building' },
    { name: 'floor_id', numeric: true, label: 'Floor' },
    { name: 'title', label: 'Title' },
  ]
  assert.deepEqual(
    formPayload(
      fields,
      { building_id: 9, floor_id: '', title: ' Same title ' },
      { id: 1, building_id: 2, floor_id: 3, title: 'Same title' },
    ),
    { floor_id: null },
  )
})

test('registration payloads preserve meaningful password spaces', () => {
  assert.deepEqual(
    formPayload(
      [{ name: 'password', label: 'Password', type: 'password' }],
      { password: '  keep my spaces  ' },
      null,
    ),
    { password: '  keep my spaces  ' },
  )
})

test('resuming work clears the blocked reason without reopening the incident', () => {
  assert.deepEqual(
    formPayload(
      [{ name: 'status', label: 'Next status' }],
      { status: 'In Progress' },
      { status: 'Blocked', blocked_reason: 'Waiting' },
    ),
    { status: 'In Progress' },
  )
  assert.deepEqual(transitions.Blocked, ['In Progress'])
  assert.deepEqual(transitions.Closed, [])
})

test('grid queries retain false filters, ignore cleared values and encode literal search', () => {
  const path = incidentQuery(
    { page: 2, pageSize: 10 },
    [{ field: 'assignee_id', sort: 'desc' }],
    {
      items: [
        { field: 'escalated', operator: 'is', value: false },
        { field: 'status', operator: 'is', value: null },
        { field: 'internal_field', operator: 'is', value: 'ignored' },
      ],
    },
    '  printer & 50%  ',
  )
  const params = new URL(path, 'http://localhost').searchParams
  assert.equal(params.get('search'), 'printer & 50%')
  assert.equal(params.get('sort_by'), 'assignee_name')
  assert.equal(params.get('escalated'), 'false')
  assert.equal(params.has('status'), false)
  assert.equal(params.has('internal_field'), false)
})

test('employee grid scope cannot be replaced by an incidental reporter filter', () => {
  const path = incidentQuery(
    { page: 0, pageSize: 25 },
    [],
    { items: [{ field: 'reporter_id', operator: 'is', value: 999 }] },
    '',
    { reporter_id: 12 },
  )
  assert.equal(new URL(path, 'http://localhost').searchParams.get('reporter_id'), '12')
})

test('assigned grid scope is fixed to the current engineer without requiring own reports', () => {
  const path = incidentQuery(
    { page: 1, pageSize: 10 },
    [{ field: 'status', sort: 'asc' }],
    { items: [{ field: 'assignee_id', operator: 'is', value: 999 }] },
    'printer',
    { assignee_id: 42 },
  )
  const params = new URL(path, 'http://localhost').searchParams
  assert.equal(params.get('assignee_id'), '42')
  assert.equal(params.has('reporter_id'), false)
  assert.equal(params.get('page'), '1')
  assert.equal(params.get('search'), 'printer')
})

test('queries reuse reads and invalidate affected resources without refetching every table', async () => {
  const client = createQueryClient()
  try {
    let reads = 0
    const building = { queryKey: ['api', '/buildings'], queryFn: async () => ++reads }
    assert.equal(await client.fetchQuery(building), 1)
    assert.equal(await client.fetchQuery(building), 1)
    client.setQueryData(['api', '/incidents/grid?page=0'], [])
    client.setQueryData(['api', '/incidents/7/notes'], [])
    await invalidateResourceQueries(client, 'users')
    assert.equal(client.getQueryState(building.queryKey)?.isInvalidated, false)
    assert.equal(client.getQueryState(['api', '/incidents/grid?page=0'])?.isInvalidated, true)
    assert.equal(client.getQueryState(['api', '/incidents/7/notes'])?.isInvalidated, true)
    await invalidateResourceQueries(client, 'buildings')
    assert.equal(await client.fetchQuery(building), 2)
    client.clear()
    assert.equal(client.getQueryData(building.queryKey), undefined)
  } finally {
    client.clear()
  }
})
