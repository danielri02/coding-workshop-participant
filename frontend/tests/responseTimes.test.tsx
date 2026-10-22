// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { ResponseTimeStats } from '../src/incidents/ResponseTimeStats'
import { createQueryClient } from '../src/services/queries'
import { api } from '../src/services/client'
import type { ApiSchemas } from '../src/types'

vi.mock('../src/services/client', () => ({
  api: vi.fn(),
  errorMessage: (error: Error) => error.message,
}))
const sample: ApiSchemas['ResponseTimeSummary'] = {
  period: 'month',
  start_at: '2026-09-21T12:00:00Z',
  end_at: '2026-10-21T12:00:00Z',
  total_count: 3,
  milestones: [
    { id: 'assigned', label: 'First assignment', sample_count: 3, average_minutes: 10 },
    { id: 'acknowledged', label: 'Acknowledgment', sample_count: 2, average_minutes: 0 },
    { id: 'resolved', label: 'Resolution', sample_count: 1, average_minutes: 120 },
  ],
}
const clients: ReturnType<typeof createQueryClient>[] = []
function mount(incident?: { id: number; category: 'HVAC' }) {
  const client = createQueryClient()
  clients.push(client)
  render(
    <QueryClientProvider client={client}>
      <ResponseTimeStats incident={incident} />
    </QueryClientProvider>,
  )
}
afterEach(() => {
  cleanup()
  clients.forEach((client) => client.clear())
  clients.length = 0
  vi.resetAllMocks()
})

test('engineer averages show acknowledgment and resolution with independent sample sizes', async () => {
  vi.mocked(api).mockResolvedValue(sample)
  mount()
  const ack = await screen.findByRole('article', { name: 'Avg. acknowledgment' })
  expect(within(ack).getByText('0 min')).toBeVisible()
  expect(ack).toHaveTextContent('2 of 3 incidents reached this milestone')
  expect(screen.getByRole('article', { name: 'Avg. resolution' })).toHaveTextContent('2.0 hr')
  expect(screen.queryByRole('article', { name: 'Avg. assignment' })).not.toBeInTheDocument()
  expect(api).toHaveBeenCalledWith('/reports/my-response-times', expect.anything())
  expect(
    screen.getByText(/Incidents currently assigned to you, reported in the last 30 days/),
  ).toBeVisible()
})

test('employee expectations include assignment, acknowledgment and resolution for the incident cohort', async () => {
  vi.mocked(api).mockResolvedValue(sample)
  mount({ id: 42, category: 'HVAC' })
  expect(await screen.findByRole('article', { name: 'Avg. assignment' })).toHaveTextContent(
    '10.0 min',
  )
  expect(
    screen.getByText(/HVAC incidents in this building, reported in the last 30 days/),
  ).toBeVisible()
  expect(screen.getByText(/not a guaranteed completion time/)).toBeVisible()
  expect(api).toHaveBeenCalledWith('/incidents/42/response-times', expect.anything())
})

test('missing history shows an explicit empty state and no misleading zero-minute averages', async () => {
  vi.mocked(api).mockResolvedValue({
    ...sample,
    total_count: 0,
    milestones: sample.milestones.map((m) => ({ ...m, sample_count: 0, average_minutes: null })),
  })
  mount()
  expect(
    await screen.findByText('No matching incidents were reported in the last 30 days.'),
  ).toBeVisible()
  expect(screen.getAllByText('—')).toHaveLength(2)
  expect(screen.queryByText('0 min')).not.toBeInTheDocument()
})

test('timing errors can be retried without hiding the rest of the incident', async () => {
  vi.mocked(api)
    .mockRejectedValueOnce(new Error('Temporarily unavailable'))
    .mockResolvedValue(sample)
  mount()
  expect(await screen.findByRole('alert')).toHaveTextContent('Temporarily unavailable')
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(await screen.findByRole('article', { name: 'Avg. resolution' })).toBeVisible()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})
