import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Alert, Box, Button, CircularProgress, Paper, Stack, Typography } from '@mui/material'
import ArrowBack from '@mui/icons-material/ArrowBack'
import Refresh from '@mui/icons-material/Refresh'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../auth/context'
import { RecordFormDialog } from '../components/RecordFormDialog'
import { ValueChip } from '../components/ValueChip'
import { activeStatuses } from '../generated/domain'
import { useApiQuery } from '../hooks/useApiQuery'
import { useLookups } from '../hooks/useLookups'
import { priorityFields } from '../resources/incidentActions'
import { floorLabel, recordLabel } from '../resources/rows'
import { api } from '../services/client'
import { invalidateResourceQueries } from '../services/queries'
import type { Incident } from '../types'
import { IncidentNotes } from './IncidentNotes'
import { IncidentProgress } from './IncidentProgress'

/** Show the employee's own report, lifecycle and conversation with facilities. */
export function EmployeeIncidentPage() {
  const { incidentId } = useParams()
  const id = Number(incidentId)
  const validId = Number.isSafeInteger(id) && id > 0 && id <= 2147483647
  const { user } = useAuth()
  const client = useQueryClient()
  const [editing, setEditing] = useState(false)
  const query = useApiQuery<Incident | null>(validId ? `/incidents/${id}` : null, null)
  const lookups = useLookups({ lookups: ['buildings', 'floors', 'seats'] })
  const incident = query.data?.id === id && query.data.reporter_id === user?.id ? query.data : null
  const active = activeStatuses.some((status) => status === incident?.status)
  const refresh = () =>
    void invalidateResourceQueries(client, 'incidents', ['buildings', 'floors', 'seats'])
  const save = async (payload: Record<string, unknown>) => {
    await api<Incident>(`/incidents/${id}/priority`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    })
    setEditing(false)
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
        <Button component={Link} to="/employee/incidents" startIcon={<ArrowBack />}>
          My incidents
        </Button>
        <Button startIcon={<Refresh />} onClick={refresh} disabled={query.loading}>
          Refresh
        </Button>
      </Stack>
      {query.loading && !query.data && <CircularProgress aria-label="Loading incident" />}
      {(!validId || query.error || (!query.loading && !incident)) && (
        <Alert severity="error">
          {query.error || 'This incident is not available in your submitted reports.'}
        </Alert>
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
              {active && (
                <Button
                  variant="outlined"
                  onClick={() => setEditing(true)}
                  disabled={query.loading}
                >
                  Priority and escalation
                </Button>
              )}
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
          {editing && active && (
            <RecordFormDialog
              title="Priority and escalation"
              fields={priorityFields}
              row={incident}
              lookups={lookups.data}
              onSave={save}
              onClose={() => setEditing(false)}
            />
          )}
        </>
      )}
    </Stack>
  )
}
