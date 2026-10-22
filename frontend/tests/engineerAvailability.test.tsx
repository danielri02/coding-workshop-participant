// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { AuthContext, type AuthState } from '../src/auth/context'
import { EngineerAvailability } from '../src/incidents/EngineerAvailability'
import { api } from '../src/services/client'
import { createQueryClient } from '../src/services/queries'
import type { User } from '../src/types'

vi.mock('../src/services/client', () => ({
  api: vi.fn(),
  errorMessage: (error: Error) => error.message,
}))

const engineer: User = {
  id: 42,
  name: 'Engineer',
  email: 'engineer@acme.inc',
  is_admin: false,
  engineer_profile: { user_id: 42, is_available: true },
}
const clients: ReturnType<typeof createQueryClient>[] = []
function mount(user = engineer) {
  const client = createQueryClient()
  clients.push(client)
  const auth: AuthState = {
    user,
    booting: false,
    notice: '',
    login: vi.fn(),
    logout: vi.fn(),
    refreshUser: vi.fn(),
    setAccount: vi.fn(),
  }
  render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={auth}>
        <EngineerAvailability />
      </AuthContext.Provider>
    </QueryClientProvider>,
  )
  return { client, auth }
}
afterEach(() => {
  cleanup()
  clients.forEach((client) => client.clear())
  clients.length = 0
  vi.resetAllMocks()
})

test('failed availability writes keep the current value and allow a retry', async () => {
  vi.mocked(api)
    .mockRejectedValueOnce(new Error('Server unavailable'))
    .mockResolvedValueOnce({ user_id: 42, is_available: false })
  const { auth } = mount()
  const control = screen.getByRole('switch', { name: 'Available for assignment' })
  await userEvent.click(control)
  expect(await screen.findByRole('alert')).toHaveTextContent('Server unavailable')
  expect(control).toBeChecked()
  expect(control).toBeEnabled()
  expect(auth.refreshUser).not.toHaveBeenCalled()
  await userEvent.click(control)
  await waitFor(() => expect(auth.refreshUser).toHaveBeenCalledOnce())
  expect(api).toHaveBeenLastCalledWith('/engineer-profiles/42', {
    method: 'PATCH',
    body: JSON.stringify({ is_available: false }),
  })
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

test('an employee without an engineer profile has no availability control', () => {
  mount({ ...engineer, engineer_profile: null })
  expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  expect(api).not.toHaveBeenCalled()
})
