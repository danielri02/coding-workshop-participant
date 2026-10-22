import type { IncidentScope } from '../incidents/scope'
import type { User } from '../types'

export interface Workspace {
  id: 'admin' | IncidentScope
  label: string
  path: string
}

/** Views narrow the account's capabilities; switching never changes its identity. */
export function availableWorkspaces(user: User): Workspace[] {
  return [
    ...(user.is_admin
      ? [{ id: 'admin' as const, label: 'Administration', path: '/admin/incidents' }]
      : []),
    ...(user.engineer_profile
      ? [{ id: 'assigned' as const, label: 'Assigned to me', path: '/engineer/incidents' }]
      : []),
    { id: 'reported', label: 'My incidents', path: '/employee/incidents' },
  ]
}

export function workspaceForPath(user: User, pathname: string): Workspace | undefined {
  return availableWorkspaces(user).find((view) =>
    pathname.startsWith(`${view.path.split('/incidents')[0]}/`),
  )
}
