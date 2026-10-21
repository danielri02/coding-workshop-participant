import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Alert, Box, Button, CircularProgress, Paper, Stack, Typography } from '@mui/material'
import ArrowBack from '@mui/icons-material/ArrowBack'
import Refresh from '@mui/icons-material/Refresh'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../auth/context'
import { RecordFormDialog } from '../components/RecordFormDialog'
import { ValueChip } from '../components/ValueChip'
import { activeStatuses, transitions } from '../generated/domain'
import { useApiQuery } from '../hooks/useApiQuery'
import { useLookups } from '../hooks/useLookups'
import { priorityFields, statusFields } from '../resources/incidentActions'
import { floorLabel, recordLabel } from '../resources/rows'
import { api } from '../services/client'
import { invalidateResourceQueries } from '../services/queries'
import type { Incident } from '../types'
import { IncidentNotes } from './IncidentNotes'
import { IncidentProgress } from './IncidentProgress'
import { incidentViews, inIncidentScope, type IncidentScope } from './scope'

/** Show scoped incident details and controls granted to its reporter/assigned engineer. */
export function IncidentDetailsPage({ scope }: { scope: IncidentScope }) {
  const view = incidentViews[scope]
  const { incidentId } = useParams()
  const id = Number(incidentId)
  const validId = Number.isSafeInteger(id) && id > 0 && id <= 2147483647
  const { user } = useAuth()
  const client = useQueryClient()
  const [editing, setEditing] = useState<'priority' | 'status' | null>(null)
  const query = useApiQuery<Incident | null>(validId ? `/incidents/${id}` : null, null)
  const lookups = useLookups({ lookups: ['buildings', 'floors', 'seats'] })
  const incident =
    query.data?.id === id && user && inIncidentScope(query.data, user, scope) ? query.data : null
  const active = activeStatuses.some((status) => status === incident?.status)
  const canChangePriority = active && incident?.reporter_id === user?.id
  const canChangeStatus = Boolean(
    incident &&
    user?.engineer_profile &&
    incident.assignee_id === user.id &&
    transitions[incident.status].length,
  )
  const refresh = () =>
    void invalidateResourceQueries(client, 'incidents', ['buildings', 'floors', 'seats'])
  const save = async (payload: Record<string, unknown>) => {
    await api<Incident>(`/incidents/${id}/${editing}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    })
    setEditing(null)
    await invalidateResourceQueries(client, 'incidents')
  }
  const details = incident
    ? [
        ['Building', recordLabel(lookups.data.buildings, incident.building_id)],
        [
          'Floor',
          incident.floor_id ? floorLabel(lookups.data, incident.floor_id) : 'Not specified',
        ],
        [
          'Seat',
          incident.seat_id
            ? recordLabel(lookups.data.seats, incident.seat_id, 'label')
            : 'Not specified',
        ],
        ['Reported by', incident.reporter_name || 'Employee'],
        ['Assigned engineer', incident.assignee_name || 'Awaiting assignment'],
        ['Reported', new Date(incident.created_at).toLocaleString()],
        [
          'Resolved',
          incident.resolved_at
            ? new Date(incident.resolved_at).toLocaleString()
            : 'Not yet resolved',
        ],
      ]
    : []
  return (
    <Stack spacing={3} sx={{ minWidth: 0 }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
        <Button component={Link} to={view.path} startIcon={<ArrowBack />}>
          {view.title}
        </Button>
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
                {canChangePriority && (
                  <Button
                    variant="outlined"
                    onClick={() => setEditing('priority')}
                    disabled={query.loading}
                  >
                    Priority and escalation
                  </Button>
                )}
                {canChangeStatus && (
                  <Button
                    variant="contained"
                    onClick={() => setEditing('status')}
                    disabled={query.loading}
                  >
                    Change status
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
                <Box key={label} sx={{ display: 'contents' }}>
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
          <IncidentNotes key={incident.id} incident={incident} />
          {editing && (editing === 'status' ? canChangeStatus : canChangePriority) && (
            <RecordFormDialog
              title={editing === 'status' ? 'Change status' : 'Priority and escalation'}
              fields={editing === 'status' ? statusFields(incident.status) : priorityFields}
              row={
                editing === 'status' ? { ...incident, status: '', blocked_reason: '' } : incident
              }
              lookups={lookups.data}
              onSave={save}
              onClose={() => setEditing(null)}
            />
          )}
        </>
      )}
    </Stack>
  )
}
