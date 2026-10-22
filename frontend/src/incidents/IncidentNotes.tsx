import { useState } from 'react'
import { Alert, Box, Button, Divider, Paper, Stack, Typography } from '@mui/material'
import { useQueryClient } from '@tanstack/react-query'
import { RecordFormDialog } from '../components/RecordFormDialog'
import { PersonLink } from '../components/PersonLink'
import { useRecordDialogs } from '../dialogs/context'
import { noteStatuses } from '../generated/domain'
import { useApiQuery } from '../hooks/useApiQuery'
import { noteFields } from '../resources/incidentFields'
import { api } from '../services/client'
import { invalidateResourceQueries } from '../services/queries'
import type { Incident, Lookups, Note } from '../types'

const emptyLookups: Lookups = { users: [], buildings: [], floors: [], seats: [] }

/** Share progress updates without exposing note editing or people-management controls. */
export function IncidentNotes({
  incident,
  embedded = false,
}: {
  incident: Incident
  embedded?: boolean
}) {
  const { setBusy } = useRecordDialogs()
  const [adding, setAdding] = useState(false)
  const client = useQueryClient()
  const path = `/incidents/${incident.id}/notes`
  const query = useApiQuery<Note[]>(path, [])
  const canAddNotes = noteStatuses.some((status) => status === incident.status)
  const refresh = () => void client.invalidateQueries({ queryKey: ['api', path] })
  const save = async (payload: Record<string, unknown>) => {
    await api<Note>(path, { method: 'POST', body: JSON.stringify(payload) })
    setAdding(false)
    await invalidateResourceQueries(client, 'notes')
  }
  const form = adding && canAddNotes && (
    <RecordFormDialog
      embedded={embedded}
      title="Add note"
      fields={noteFields}
      lookups={emptyLookups}
      onSave={save}
      onClose={() => setAdding(false)}
      onBusyChange={embedded ? setBusy : undefined}
      subtitle="Your note will be shared with the reporter and facilities team."
    />
  )
  if (embedded && form) return form
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h6" component="h2">
          Notes and updates
        </Typography>
        {canAddNotes && (
          <Button variant="outlined" onClick={() => setAdding(true)}>
            Add note
          </Button>
        )}
      </Stack>
      {!canAddNotes && (
        <Alert severity="info" sx={{ mb: 2 }}>
          This incident is {incident.status.toLowerCase()}. Its updates remain available to read.
        </Alert>
      )}
      {query.error && (
        <Alert severity="error" action={<Button onClick={refresh}>Retry</Button>}>
          {query.error}
        </Alert>
      )}
      {query.loading && (
        <Typography role="status" variant="body2">
          Loading updates…
        </Typography>
      )}
      {!query.loading && !query.error && !query.data.length && (
        <Typography variant="body2" color="text.secondary">
          {canAddNotes
            ? 'No updates yet. Add a note to share more information with facilities.'
            : 'No updates were recorded for this incident.'}
        </Typography>
      )}
      <Stack
        spacing={2}
        divider={<Divider />}
        component="ol"
        aria-label="Incident updates"
        sx={{ listStyle: 'none', p: 0, m: 0 }}
      >
        {query.data.map((note) => (
          <Box component="li" key={note.id}>
            <Typography variant="subtitle2">
              <PersonLink id={note.author_id} name={note.author_name || 'Facilities team'} />
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {new Date(note.created_at).toLocaleString()}
            </Typography>
            <Typography
              variant="body2"
              sx={{ mt: 1, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
            >
              {note.body}
            </Typography>
          </Box>
        ))}
      </Stack>
      {!embedded && form}
    </Paper>
  )
}
