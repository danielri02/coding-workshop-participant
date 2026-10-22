import { expect, test } from 'vitest'
import { availableWorkspaces, workspaceForPath } from '../src/auth/workspaces'
import type { User } from '../src/types'

const employee: User = {
  id: 42,
  name: 'Employee',
  email: 'employee@acme.inc',
  is_admin: false,
  engineer_profile: null,
}

test.each([
  [false, false, ['reported']],
  [false, true, ['assigned', 'reported']],
  [true, false, ['admin', 'reported']],
  [true, true, ['admin', 'assigned', 'reported']],
] as const)('workspace grants combine admin=%s and engineer=%s', (admin, engineer, expected) => {
  const user = {
    ...employee,
    is_admin: admin,
    engineer_profile: engineer ? { user_id: employee.id, is_available: true } : null,
  }
  expect(availableWorkspaces(user).map((workspace) => workspace.id)).toEqual(expected)
})

test('direct URLs require the current capability and cannot match a similar prefix', () => {
  expect(workspaceForPath(employee, '/employee/tickets/8')?.id).toBe('reported')
  for (const path of ['/admin/incidents', '/engineer/incidents', '/employee-other/incidents', '/'])
    expect(workspaceForPath(employee, path)).toBeUndefined()
  expect(workspaceForPath({ ...employee, is_admin: true }, '/admin/reports/timings')?.id).toBe(
    'admin',
  )
  expect(workspaceForPath({ ...employee, is_admin: true }, '/engineer/incidents')).toBeUndefined()
})
