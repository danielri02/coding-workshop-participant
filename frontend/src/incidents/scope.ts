import type { Incident, User } from '../types'

export const incidentViews = {
  reported: {
    path: '/employee/incidents',
    title: 'My incidents',
    search: 'Search my incidents',
    description: 'Report a workplace issue and follow updates from the facilities team.',
    unavailable: 'This incident is not available in your submitted reports.',
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
export function inIncidentScope(incident: Incident, user: User, scope: IncidentScope): boolean {
  return scope === 'assigned'
    ? Boolean(user.engineer_profile) && incident.assignee_id === user.id
    : incident.reporter_id === user.id
}
