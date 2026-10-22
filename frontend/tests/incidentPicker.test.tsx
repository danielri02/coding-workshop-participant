// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { IncidentPicker } from '../src/components/IncidentPicker'
import { createQueryClient } from '../src/services/queries'
import { api } from '../src/services/client'
import type { Incident } from '../src/types'

vi.mock('../src/services/client', () => ({
  api: vi.fn(),
  errorMessage: (error: Error) => error.message,
}))

const incident = (id: number, title: string): Incident => ({
  id,
  title,
  description: 'Leaking tap',
  category: 'Plumbing',
  priority: 'Low',
  status: 'Open',
  building_id: 1,
  floor_id: null,
  seat_id: null,
  reporter_id: 1,
  reporter_name: 'Reporter',
  assignee_id: null,
  assignee_name: null,
  blocked_reason: null,
  escalation_reason: null,
  created_at: '2026-10-21T00:00:00Z',
  assigned_at: null,
  acknowledged_at: null,
  resolved_at: null,
})
const clients: ReturnType<typeof createQueryClient>[] = []
function mount(value: Incident | null = null) {
  const client = createQueryClient()
  clients.push(client)
  const changed = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <IncidentPicker id={value?.id || null} value={value} onChange={changed} />
    </QueryClientProvider>,
  )
  return changed
}
afterEach(() => {
  cleanup()
  clients.forEach((client) => client.clear())
  clients.length = 0
  vi.resetAllMocks()
})

test('the picker debounces server searches, bounds results and accepts an exact incident ID', async () => {
  vi.mocked(api).mockImplementation(async (path) =>
    path === '/incidents/812'
      ? incident(812, 'Old report')
      : {
          rows: path.includes('search=') ? [] : [incident(1, 'Recent report')],
          row_count: 300,
          page: 0,
          page_size: 25,
        },
  )
  const changed = mount()
  const actor = userEvent.setup()
  const input = screen.getByRole('combobox', { name: 'Incident' })
  await actor.click(input)
  expect(await screen.findByRole('option', { name: /Recent report/ })).toBeVisible()
  expect(screen.getByText('300 matches. Refine your search to narrow the results.')).toBeVisible()
  await actor.type(input, '#812')
  expect(vi.mocked(api).mock.calls.some(([path]) => path.includes('search='))).toBe(false)
  await actor.click(await screen.findByRole('option', { name: /Old report/ }))
  expect(changed).toHaveBeenCalledWith(incident(812, 'Old report'))
  const requests = vi.mocked(api).mock.calls.map(([path]) => path)
  expect(requests).toContain('/incidents/812')
  for (const path of requests.filter((path) => path.startsWith('/incidents/grid'))) {
    expect(new URL(path, 'http://test').searchParams.get('page_size')).toBe('25')
  }
  expect(requests).not.toContain('/incidents')
})

test('a selected incident remains visible and can be cleared without loading all incidents', async () => {
  const changed = mount(incident(45, 'Selected report'))
  expect(screen.getByRole('combobox')).toHaveValue('#45 · Selected report · Open')
  await userEvent.tab()
  await userEvent.click(screen.getByLabelText('Clear'))
  expect(changed).toHaveBeenCalledWith(null)
  expect(api).not.toHaveBeenCalled()
})

test('failed searches show a visible error while leaving the picker editable', async () => {
  vi.mocked(api).mockRejectedValue(new Error('Temporarily unavailable'))
  mount()
  await userEvent.click(screen.getByRole('combobox'))
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('Temporarily unavailable'),
  )
  expect(screen.getByRole('combobox')).toBeEnabled()
})
