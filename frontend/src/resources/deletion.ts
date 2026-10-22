import type { DeletionPreview } from '../types'

/** Describe the server's concrete deletion plan, including preserved assignments. */
export function deletionWarning(preview: DeletionPreview): string {
  const names: Record<string, [string, string]> = {
    users: ['user account', 'user accounts'],
    engineers: ['engineer profile', 'engineer profiles'],
    buildings: ['building', 'buildings'],
    floors: ['floor', 'floors'],
    seats: ['seat', 'seats'],
    incidents: ['incident', 'incidents'],
    tickets: ['ticket', 'tickets'],
    notes: ['note', 'notes'],
  }
  const counts = Object.entries(preview.counts)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => `${count} ${names[key]?.[count === 1 ? 0 : 1] || key}`)
  return [
    `Permanently delete: ${counts.join(', ')}.`,
    preview.unassigned_incidents
      ? `${preview.unassigned_incidents} assigned incidents will be preserved and unassigned. Active incidents return to Open; resolved and closed incidents keep their status.`
      : '',
    preview.counts.users
      ? 'Deleted users will lose access and their sign-in sessions will be revoked.'
      : '',
    'This cannot be undone.',
  ]
    .filter(Boolean)
    .join('\n\n')
}
