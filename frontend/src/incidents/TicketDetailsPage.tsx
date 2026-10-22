import { Alert, Button, CircularProgress, Paper, Stack, Typography } from '@mui/material'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../auth/context'
import { useWorkspace } from '../hooks/useWorkspace'
import { useApiQuery } from '../hooks/useApiQuery'
import { useLookups } from '../hooks/useLookups'
import { floorLabel, recordLabel } from '../resources/rows'
import { RecordLink } from '../components/RecordLink'
import type { Ticket } from '../types'
import { IncidentDetailsPage } from './IncidentDetailsPage'

/** The original report stays private; its incident provides the shared progress. */
export function TicketDetailsPage({
  recordId,
  embedded = false,
}: {
  recordId?: number
  embedded?: boolean
}) {
  const params = useParams()
  const id = recordId ?? Number(params.incidentId)
  const valid = Number.isSafeInteger(id) && id > 0 && id <= 2147483647
  const { user } = useAuth()
  const { adminView, workspace } = useWorkspace()
  const query = useApiQuery<Ticket | null>(valid ? `/tickets/${id}` : null, null)
  const lookups = useLookups({ lookups: ['buildings', 'floors', 'seats'] })
  const ticket = query.data
  const allowed =
    ticket &&
    (adminView ||
      ticket.reporter_id === user?.id ||
      (workspace?.id === 'assigned' &&
        user?.engineer_profile &&
        ticket.incident.assignee_id === user.id))
  if (query.loading && !ticket) return <CircularProgress aria-label="Loading ticket" />
  if (!valid || query.error || !allowed)
    return (
      <Alert severity="error">
        {query.error || 'This ticket is not available in this workspace.'}
      </Alert>
    )
  return (
    <Stack spacing={3}>
      {!embedded && (
        <Button component={Link} to="/employee/tickets">
          My tickets
        </Button>
      )}
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Typography component="h1" variant="h5">
          Ticket #{ticket.id}
        </Typography>
        <Typography component="h2" variant="h6" sx={{ mt: 1 }}>
          Original report
        </Typography>
        <Typography component="p" variant="subtitle1">
          {ticket.title}
        </Typography>
        <Typography sx={{ whiteSpace: 'pre-wrap', my: 2 }}>{ticket.description}</Typography>
        <Typography variant="body2" color="text.secondary">
          Reported by {ticket.reporter_name} on {new Date(ticket.created_at).toLocaleString()}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Reported location: {recordLabel(lookups.data.buildings, ticket.building_id)}
          {ticket.floor_id ? ` · ${floorLabel(lookups.data, ticket.floor_id)}` : ''}
          {ticket.seat_id ? ` · ${recordLabel(lookups.data.seats, ticket.seat_id, 'label')}` : ''}
        </Typography>
        <Typography variant="body2" sx={{ mt: 2 }}>
          Tracking{' '}
          <RecordLink resource="incidents" id={ticket.incident_id}>
            incident #{ticket.incident_id}
          </RecordLink>
          . Your original report remains unchanged if incidents are merged.
        </Typography>
      </Paper>
      <IncidentDetailsPage key={ticket.incident_id} recordId={ticket.incident_id} embedded />
    </Stack>
  )
}
