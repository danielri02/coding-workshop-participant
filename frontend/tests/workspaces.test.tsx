// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { Suspense } from 'react'
import { AuthContext, type AuthState } from '../src/auth/context'
import { WorkspaceSwitcher } from '../src/components/WorkspaceSwitcher'
import { Application } from '../src/App'
import type { User } from '../src/types'

vi.mock('../src/pages/AdminRoutes', () => ({ default: () => <h1>Admin routes</h1> }))
vi.mock('../src/pages/MemberRoutes', () => ({ default: () => <h1>Member routes</h1> }))

const admin: User = {
  id: 42,
  name: 'Overlapping account',
  email: 'overlap@acme.inc',
  is_admin: true,
  engineer_profile: { user_id: 42, is_available: true },
}

function Location() {
  return <output data-testid="location">{useLocation().pathname}</output>
}

function mount(user: User, path: string, routing = false) {
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
    <MemoryRouter initialEntries={[path]}>
      <AuthContext.Provider value={auth}>
        <Suspense fallback="Loading workspace">
          {routing ? <Application /> : <WorkspaceSwitcher />}
        </Suspense>
        <Location />
      </AuthContext.Provider>
    </MemoryRouter>,
  )
  return auth
}

afterEach(cleanup)

test('an admin engineer can switch all three views without reauthenticating or editing capabilities', async () => {
  const actor = userEvent.setup()
  const auth = mount(admin, '/admin/incidents')
  for (const [label, path] of [
    ['My incidents', '/employee/incidents'],
    ['Assigned to me', '/engineer/incidents'],
    ['Administration', '/admin/incidents'],
  ]) {
    await actor.click(screen.getByRole('combobox', { name: 'Workspace' }))
    await actor.click(screen.getByRole('option', { name: label, exact: true }))
    expect(screen.getByTestId('location')).toHaveTextContent(path)
  }
  expect(auth.login).not.toHaveBeenCalled()
  expect(auth.setAccount).not.toHaveBeenCalled()
  expect(admin.is_admin).toBe(true)
})

test('an admin without an engineer profile has no assigned-work option', async () => {
  mount({ ...admin, engineer_profile: null }, '/employee/incidents')
  await userEvent.click(screen.getByRole('combobox', { name: 'Workspace' }))
  expect(screen.getAllByRole('option')).toHaveLength(2)
  expect(screen.queryByRole('option', { name: 'Assigned to me' })).not.toBeInTheDocument()
})

test('ordinary members retain their existing navigation rather than an admin switcher', () => {
  mount({ ...admin, is_admin: false }, '/engineer/incidents')
  expect(screen.queryByRole('combobox', { name: 'Workspace' })).not.toBeInTheDocument()
})

test.each([
  [true, true, '/employee/incidents', '/employee/incidents', 'Member routes'],
  [true, true, '/engineer/incidents/7', '/engineer/incidents/7', 'Member routes'],
  [true, false, '/engineer/incidents', '/admin/incidents', 'Admin routes'],
  [false, false, '/admin/incidents', '/employee/incidents', 'Member routes'],
  [false, true, '/admin/incidents', '/engineer/incidents', 'Member routes'],
  [true, true, '/', '/admin/incidents', 'Admin routes'],
] as const)(
  'URL routing respects admin=%s engineer=%s at %s',
  async (isAdmin, engineer, path, expectedPath, heading) => {
    mount(
      { ...admin, is_admin: isAdmin, engineer_profile: engineer ? admin.engineer_profile : null },
      path,
      true,
    )
    expect(await screen.findByRole('heading', { name: heading })).toBeVisible()
    expect(screen.getByTestId('location')).toHaveTextContent(expectedPath)
  },
)
