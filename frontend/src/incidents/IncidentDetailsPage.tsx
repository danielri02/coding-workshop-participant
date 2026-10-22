import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Alert, Box, Button, CircularProgress, Paper, Stack, Typography } from '@mui/material'
import ArrowBack from '@mui/icons-material/ArrowBack'
import Refresh from '@mui/icons-material/Refresh'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../auth/context'
import { RecordFormDialog } from '../components/RecordFormDialog'
import { RecordLink } from '../components/RecordLink'
import { PersonLink } from '../components/PersonLink'
import { useRecordDialogs } from '../dialogs/context'
import { ValueChip } from '../components/ValueChip'
import { transitions } from '../generated/domain'
import { useApiQuery } from '../hooks/useApiQuery'
import { useLookups } from '../hooks/useLookups'
import { statusFields } from '../resources/incidentActions'
import { floorLabel, recordLabel } from '../resources/rows'
import { api, errorMessage } from '../services/client'
import { invalidateResourceQueries } from '../services/queries'
import type { Incident } from '../types'
import { IncidentNotes } from './IncidentNotes'
import { ResponseTimeStats } from './ResponseTimeStats'
import { IncidentProgress } from './IncidentProgress'
import { incidentViews, inIncidentScope, type IncidentScope } from './scope'

/** Show scoped incident details and controls granted to its reporter/assigned engineer. */
export function IncidentDetailsPage({
  scope,
  recordId,
  embedded = false,
}: {
  scope?: IncidentScope
  recordId?: number
  embedded?: boolean
}) {
  const view = incidentViews[scope || 'reported']
  const { setBusy } = useRecordDialogs()
  const { incidentId } = useParams()
  const id = recordId ?? Number(incidentId)
  const validId = Number.isSafeInteger(id) && id > 0 && id <= 2147483647
  const { user } = useAuth()
  const client = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [accepting, setAccepting] = useState(false)
  const [actionError, setActionError] = useState('')
  const query = useApiQuery<Incident | null>(validId ? `/incidents/${id}` : null, null)
  const lookups = useLookups({ lookups: ['buildings', 'floors', 'seats'] })
  const incident =
    query.data?.id === id && user && (!scope || inIncidentScope(query.data, user, scope))
      ? query.data
      : null
  const canChangeStatus = Boolean(
    incident &&
    user?.engineer_profile &&
    incident.assignee_id === user.id &&
    transitions[incident.status].length,
  )
  const refresh = () =>
    void invalidateResourceQueries(client, 'incidents', ['buildings', 'floors', 'seats'])
  const save = async (payload: Record<string, unknown>) => {
    await api<Incident>(`/incidents/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    })
    setEditing(false)
    await invalidateResourceQueries(client, 'incidents')
  }
  const details = incident
    ? [
        [
          'Building',
          <RecordLink resource="buildings" id={incident.building_id}>
            {recordLabel(lookups.data.buildings, incident.building_id)}
          </RecordLink>,
        ],
        [
          'Floor',
          incident.floor_id ? (
            <RecordLink resource="floors" id={incident.floor_id}>
              {floorLabel(lookups.data, incident.floor_id)}
            </RecordLink>
          ) : (
            'Not specified'
          ),
        ],
        [
          'Seat',
          incident.seat_id ? (
            <RecordLink resource="seats" id={incident.seat_id}>
              {recordLabel(lookups.data.seats, incident.seat_id, 'label')}
            </RecordLink>
          ) : (
            'Not specified'
          ),
        ],
        [
          'Reported by',
          <PersonLink id={incident.reporter_id} name={incident.reporter_name || 'Employee'} />,
        ],
        [
          'Assigned engineer',
          incident.assignee_id ? (
            <RecordLink resource="engineers" id={incident.assignee_id}>
              {incident.assignee_name || `#${incident.assignee_id}`}
            </RecordLink>
          ) : (
            'Awaiting assignment'
          ),
        ],
        ['Reported', new Date(incident.created_at).toLocaleString()],
        [
          'Resolved',
          incident.resolved_at
            ? new Date(incident.resolved_at).toLocaleString()
            : 'Not yet resolved',
        ],
      ]
    : []
  const form = editing && canChangeStatus && incident && (
    <RecordFormDialog
      embedded={embedded}
      title="Change status"
      fields={statusFields(incident.status)}
      row={{ ...incident, status: '', blocked_reason: '' }}
      lookups={lookups.data}
      onSave={save}
      onClose={() => setEditing(false)}
      onBusyChange={embedded ? setBusy : undefined}
    />
  )
  if (embedded && form) return form
  return (
    <Stack spacing={3} sx={{ minWidth: 0 }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
        {!embedded && (
          <Button component={Link} to={view.path} startIcon={<ArrowBack />}>
            {view.title}
          </Button>
        )}
        <Button startIcon={<Refresh />} onClick={refresh} disabled={query.loading}>
          Refresh
        </Button>
      </Stack>
      {query.loading && !query.data && <CircularProgress aria-label="Loading incident" />}
      {(!validId || query.error || (!query.loading && !incident)) && (
        <Alert severity="error">{query.error || view.unavailable}</Alert>
      )}
      {incident && !query.error && (
        <>
          <Box>
            <Typography variant="overline" color="text.secondary">
              Incident #{incident.id}
            </Typography>
            <Typography
              component="h1"
              variant="h4"
              sx={{ fontWeight: 750, overflowWrap: 'anywhere' }}
            >
              {incident.title}
            </Typography>
            <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 1, mt: 2 }}>
              <ValueChip value={incident.status} />
              <ValueChip value={incident.priority} />
              <ValueChip value={incident.category} />
            </Stack>
          </Box>
          <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
            {actionError && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {actionError}
              </Alert>
            )}
            <IncidentProgress status={incident.status} />
          </Paper>
          {incident.blocked_reason && (
            <Alert severity="warning">Work is blocked: {incident.blocked_reason}</Alert>
          )}
          {incident.escalation_reason && (
            <Alert severity="info">Escalation: {incident.escalation_reason}</Alert>
          )}
          {lookups.error && <Alert severity="error">{lookups.error}</Alert>}
          <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={2}
              sx={{ justifyContent: 'space-between', mb: 2 }}
            >
              <Typography component="h2" variant="h6">
                Report details
              </Typography>
              <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 1 }}>
                {canChangeStatus && (
                  <Button
                    variant="contained"
                    onClick={async () => {
                      if (incident.status !== 'Assigned') {
                        setEditing(true)
                        return
                      }
                      setAccepting(true)
                      setActionError('')
                      try {
                        await save({ status: 'In Progress' })
                      } catch (failure) {
                        setActionError(errorMessage(failure))
                      } finally {
                        setAccepting(false)
                      }
                    }}
                    disabled={query.loading || accepting}
                  >
                    {incident.status === 'Assigned' ? 'Accept and start work' : 'Change status'}
                  </Button>
                )}
              </Stack>
            </Stack>
            <Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', mb: 3 }}>
              {incident.description}
            </Typography>
            <Box
              component="dl"
              sx={{
                m: 0,
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: '160px 1fr' },
                gap: { xs: 1, sm: 2 },
              }}
            >
              {details.map(([label, value]) => (
                <Box key={String(label)} sx={{ display: 'contents' }}>
                  <Typography component="dt" variant="body2" color="text.secondary">
                    {label}
                  </Typography>
                  <Typography
                    component="dd"
                    variant="body2"
                    sx={{ m: 0, overflowWrap: 'anywhere' }}
                  >
                    {value}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Paper>
          {scope !== 'assigned' && incident.reporter_id === user?.id && (
            <ResponseTimeStats key={`response-times:${incident.id}`} incident={incident} />
          )}
          <IncidentNotes key={`notes:${incident.id}`} incident={incident} embedded={embedded} />
          {!embedded && form}
        </>
      )}
    </Stack>
  )
}
