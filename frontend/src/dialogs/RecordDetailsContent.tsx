import { useWorkspace } from '../hooks/useWorkspace'
import { Alert, Box, Button, CircularProgress, Stack, Typography } from '@mui/material'
import { useAuth } from '../auth/context'
import { RecordLink } from '../components/RecordLink'
import { RelatedLink } from '../components/RelatedLink'
import type { RowAction } from '../components/ResourceGrid'
import { incidentCommands } from '../resources/incidentActions'
import { useApiQuery } from '../hooks/useApiQuery'
import { decorateRow, floorLabel, recordLabel } from '../resources/rows'
import type { ResourceDefinition } from '../resources/definitions'
import type { AdminRow, ApiRecord, Lookups, ResourceKey } from '../types'

const relationships: Partial<Record<keyof AdminRow, ResourceKey>> = {
  building_id: 'buildings',
  floor_id: 'floors',
  seat_id: 'seats',
  assignee_id: 'engineers',
  reporter_id: 'users',
  author_id: 'users',
  user_id: 'users',
  incident_id: 'incidents',
  merged_into_id: 'incidents',
}
const labels: Record<string, string> = {
  building_id: 'Building',
  floor_id: 'Floor',
  seat_id: 'Seat',
  assignee_id: 'Assigned engineer',
  reporter_id: 'Reported by',
  author_id: 'Author',
  user_id: 'Employee',
  incident_id: 'Incident',
  merged_into_id: 'Merged into',
  user_name: 'Name',
  user_email: 'Email',
}

/** Read fresh values and expose only relationships already authorized for this actor. */
export function RecordDetailsContent({
  resource,
  id,
  label,
  lookups,
  onAction,
}: {
  resource: ResourceDefinition
  id: number
  label?: string
  lookups: Lookups
  onAction: (action: RowAction, row: AdminRow) => void
}) {
  const { user } = useAuth()
  const { adminView, workspace } = useWorkspace()
  const query = useApiQuery<ApiRecord | null>(`${resource.endpoint}/${id}`, null)
  if (query.error) return <Alert severity="error">{query.error}</Alert>
  if (!query.data) return <CircularProgress aria-label="Loading record" />
  const record = decorateRow(resource.key, query.data, lookups)
  const admin = adminView
  const display = (field: string, value: unknown): string => {
    if (value === null || value === undefined || value === '') return '—'
    if (field === 'assignee_id') return record.assignee_name || recordLabel(lookups.users, value)
    if (field === 'building_id') return recordLabel(lookups.buildings, value)
    if (field === 'floor_id') return floorLabel(lookups, value)
    if (field === 'seat_id') return recordLabel(lookups.seats, value, 'label')
    if (field === 'reporter_id') return record.reporter_name || recordLabel(lookups.users, value)
    if (field === 'author_id') return record.author_name || recordLabel(lookups.users, value)
    if (field === 'user_id')
      return admin ? recordLabel(lookups.users, value) : label || `#${String(value)}`
    if (field.endsWith('_at')) return new Date(String(value)).toLocaleString()
    if (typeof value === 'boolean') return value ? 'Yes' : 'No'
    return String(value)
  }
  return (
    <Stack spacing={3}>
      <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 2 }}>
        {resource.key === 'incidents' && (
          <RelatedLink
            resource="tickets"
            filters={{ incident_id: id }}
            title={`Tickets for incident #${id}`}
          >
            View tickets ({record.ticket_count || 0})
          </RelatedLink>
        )}
        {resource.key === 'incidents' && (
          <RelatedLink
            resource="notes"
            filters={{ incident_id: id }}
            title={`Notes for incident #${id}`}
          >
            View notes
          </RelatedLink>
        )}
        {resource.key === 'buildings' && (
          <RelatedLink
            resource="floors"
            filters={{ building_id: id }}
            title={`Floors in ${record.name}`}
          >
            View floors
          </RelatedLink>
        )}
        {resource.key === 'floors' && (
          <RelatedLink
            resource="seats"
            filters={{ floor_id: id }}
            title={`Seats on ${recordLabel(lookups.buildings, record.building_id)} · Floor ${record.label}`}
          >
            View seats
          </RelatedLink>
        )}
        {(['buildings', 'floors', 'seats'] as ResourceKey[]).includes(resource.key) && (
          <RelatedLink
            resource="incidents"
            filters={{
              [resource.key === 'buildings'
                ? 'building_id'
                : resource.key === 'floors'
                  ? 'floor_id'
                  : 'seat_id']: id,
            }}
            title={`Incidents at ${record.name || record.label || `#${id}`}`}
          >
            View incidents
          </RelatedLink>
        )}
        {resource.key === 'engineers' &&
          (admin || (workspace?.id === 'assigned' && user?.id === id && user.engineer_profile)) && (
            <RelatedLink
              resource="incidents"
              filters={{ assignee_id: id }}
              title={`Incidents assigned to ${label || record.user_name}`}
            >
              Assigned incidents
            </RelatedLink>
          )}
        {resource.key === 'users' && (
          <>
            <RelatedLink
              resource="tickets"
              filters={{ reporter_id: id }}
              title={`Tickets reported by ${record.name}`}
            >
              Reported tickets
            </RelatedLink>
            {record.engineer_profile && (
              <RecordLink resource="engineers" id={id}>
                Engineer profile
              </RecordLink>
            )}
          </>
        )}
      </Stack>
      {admin && !resource.readOnly && (
        <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 1 }}>
          <Button
            disabled={Boolean(record.merged_into_id)}
            variant="outlined"
            onClick={() => onAction('edit', record)}
          >
            Edit {resource.singular}
          </Button>
          {resource.key === 'incidents' &&
            !record.merged_into_id &&
            incidentCommands().map((command) => (
              <Button
                key={command.action}
                variant="outlined"
                onClick={() => onAction(command.action, record)}
              >
                {command.label}
              </Button>
            ))}
          <Button color="error" onClick={() => onAction('delete', record)}>
            Delete {resource.singular}
          </Button>
        </Stack>
      )}
      <Box
        component="dl"
        sx={{ m: 0, display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '170px 1fr' }, gap: 2 }}
      >
        {Object.entries(record)
          .filter(
            ([field, value]) =>
              (typeof value !== 'object' || value === null) &&
              ![
                'assignee_name',
                'reporter_name',
                'author_name',
                'building_name',
                'floor_name',
              ].includes(field) &&
              (admin || !['user_name', 'user_email'].includes(field)),
          )
          .map(([field, value]) => {
            const destination = relationships[field as keyof AdminRow]
            const canLink =
              destination &&
              value != null &&
              (destination !== 'users' || admin || value === user?.id)
            return (
              <Box key={field} sx={{ display: 'contents' }}>
                <Typography
                  component="dt"
                  variant="body2"
                  color="text.secondary"
                  sx={{ textTransform: 'capitalize' }}
                >
                  {labels[field] || field.replaceAll('_', ' ')}
                </Typography>
                <Typography
                  component="dd"
                  variant="body2"
                  sx={{ m: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                >
                  {canLink ? (
                    <RecordLink resource={destination} id={Number(value)}>
                      {display(field, value)}
                    </RecordLink>
                  ) : (
                    display(field, value)
                  )}
                </Typography>
              </Box>
            )
          })}
      </Box>
    </Stack>
  )
}
