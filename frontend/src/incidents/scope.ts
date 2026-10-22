import type { Incident, Ticket, User } from '../types'

export const incidentViews = {
  reported: {
    path: '/employee/tickets',
    title: 'My tickets',
    search: 'Search my tickets',
    description: 'Report a workplace issue and follow updates from the facilities team.',
    unavailable: 'This ticket is not available in your submitted reports.',
  },
  assigned: {
    path: '/engineer/incidents',
    title: 'Assigned incidents',
    search: 'Search assigned incidents',
    description: 'Manage incidents assigned to you and keep their reporters informed.',
    unavailable: 'This incident is not currently assigned to you.',
  },
} as const
export type IncidentScope = keyof typeof incidentViews

/** Narrow each view within the account's additive backend read permissions. */
export function inIncidentScope(
  incident: Incident | Ticket,
  user: User,
  scope: IncidentScope,
): boolean {
  return scope === 'assigned'
    ? Boolean(user.engineer_profile) &&
        ('incident' in incident ? incident.incident.assignee_id : incident.assignee_id) === user.id
    : 'reporter_id' in incident && incident.reporter_id === user.id
}
