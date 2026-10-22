import { expect, test } from 'vitest'
import { defaultGridSort, gridQuery } from '../src/resources/gridQuery'
import { dialogEntry } from '../src/dialogs/navigation'
import { resources } from '../src/resources/definitions'
import type { GridFilterModel } from '@mui/x-data-grid'
import type { ResourceKey } from '../src/types'

const page = { page: 2, pageSize: 10 }
const paramsFor = (resource: ResourceKey, filters: GridFilterModel = { items: [] }) => {
  const definition = resources.find((item) => item.key === resource)!
  return new URL(
    gridQuery(definition, page, [], filters, '  50% & office  ', { incident_id: 42 })!,
    'http://localhost',
  )
}

test('every CRUD grid uses bounded server paging with matching dialog sort defaults', () => {
  for (const resource of resources) {
    const url = paramsFor(resource.key)
    expect(url.pathname.endsWith('/grid')).toBe(true)
    expect(url.searchParams.get('page')).toBe('2')
    expect(url.searchParams.get('page_size')).toBe('10')
    expect(url.searchParams.get('search')).toBe('50% & office')
    const sort = defaultGridSort(resource.key)
    expect(url.searchParams.get('sort_by')).toBe(sort.field)
    expect(url.searchParams.get('sort_direction')).toBe(sort.sort)
    const entry = dialogEntry({
      kind: 'collection',
      resource: resource.key,
      filters: {},
      title: 'Related',
    })
    expect(entry.state.sortField).toBe(sort.field)
    expect(entry.state.sortDirection).toBe(sort.sort)
  }
})

test('column filters preserve false, empty operators, multiple choices and incomplete editors', () => {
  const filter = (operator: string, value?: unknown) => ({
    items: [{ field: 'is_admin', operator, value }],
  })
  expect(paramsFor('users', filter('is', false)).searchParams.get('filter_value')).toBe('false')
  expect(paramsFor('users', filter('isEmpty')).searchParams.get('filter_operator')).toBe('isEmpty')
  expect(paramsFor('users', filter('contains', '')).searchParams.has('filter_value')).toBe(false)
  expect(
    paramsFor('users', filter('isAnyOf', ['Admin', 'Employee'])).searchParams.getAll(
      'filter_values',
    ),
  ).toEqual(['Admin', 'Employee'])
})

test('note grids require a parent and date filters send an explicit UTC timestamp', () => {
  const notes = resources.find((item) => item.key === 'notes')!
  expect(gridQuery(notes, page, [], { items: [] }, '')).toBeNull()
  const url = paramsFor('notes', {
    items: [{ field: 'created_at', operator: 'after', value: '2026-10-22T10:30:00-04:00' }],
  })
  expect(url.pathname).toBe('/incidents/42/notes/grid')
  expect(url.searchParams.get('filter_value')).toBe('2026-10-22T14:30:00.000Z')
  const incomplete = paramsFor('notes', {
    items: [{ field: 'created_at', operator: 'is', value: 'invalid' }],
  })
  expect(incomplete.searchParams.has('filter_value')).toBe(false)
})

test('related location grids carry fixed parent scopes separately from column filters', () => {
  const filters = { items: [{ field: 'label', operator: 'contains', value: '1' }] }
  const floors = resources.find((item) => item.key === 'floors')!
  const seats = resources.find((item) => item.key === 'seats')!
  const floorUrl = new URL(
    gridQuery(floors, page, [], filters, '', { building_id: 12 })!,
    'http://localhost',
  )
  expect(floorUrl.searchParams.get('building_id')).toBe('12')
  expect(floorUrl.searchParams.get('filter_field')).toBe('label')
  const seatUrl = new URL(
    gridQuery(seats, page, [], filters, '', { floor_id: 34 })!,
    'http://localhost',
  )
  expect(seatUrl.searchParams.get('floor_id')).toBe('34')
})

test('ticket grids combine parent scope with incident status filters and ticket sorting', () => {
  const tickets = resources.find((item) => item.key === 'tickets')!
  expect(tickets.hidden).not.toBe(true)
  const url = new URL(
    gridQuery(
      tickets,
      page,
      [{ field: 'incident_id', sort: 'asc' }],
      { items: [{ field: 'status', operator: 'is', value: 'Blocked' }] },
      'leak',
      { incident_id: 42 },
    )!,
    'http://localhost',
  )
  expect(url.pathname).toBe('/tickets/grid')
  expect(url.searchParams.get('incident_id')).toBe('42')
  expect(url.searchParams.get('status')).toBe('Blocked')
  expect(url.searchParams.get('sort_by')).toBe('incident_id')
  expect(url.searchParams.get('search')).toBe('leak')
})
