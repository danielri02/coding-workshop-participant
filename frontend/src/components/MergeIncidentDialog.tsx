import { useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material'
import { IncidentPicker } from './IncidentPicker'
import { useRecordDialogs } from '../dialogs/context'
import { api, errorMessage } from '../services/client'
import type { AdminRow, Incident } from '../types'

/** Confirm a whole-incident merge on the existing single dialog surface. */
export function MergeIncidentDialog({
  source,
  embedded = false,
  onClose,
  onMerged,
}: {
  source: AdminRow
  embedded?: boolean
  onClose: () => void
  onMerged: () => void
}) {
  const [target, setTarget] = useState<Incident | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { setBusy: setNavigationBusy } = useRecordDialogs()
  const save = async () => {
    if (!target) return
    setBusy(true)
    if (embedded) setNavigationBusy(true)
    setError('')
    try {
      await api<Incident>(`/incidents/${source.id}/merge`, {
        method: 'POST',
        body: JSON.stringify({ target_incident_id: target.id }),
      })
      onMerged()
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setBusy(false)
      if (embedded) setNavigationBusy(false)
    }
  }
  const content = (
    <Stack spacing={3}>
      {embedded && (
        <Typography component="h2" variant="h6">
          Merge incident #{source.id}
        </Typography>
      )}
      <Typography>
        Move all {source.ticket_count ?? 0} tickets and all notes from “{source.title}” to the
        selected incident. Close this incident and retain a merge reference.
      </Typography>
      <IncidentPicker
        id={target?.id || null}
        value={target}
        onChange={setTarget}
        excludeId={source.id}
        mergeTargets
      />
      <Alert severity="warning">
        The target keeps its location, category, priority, engineer and response-time milestones.
        Original ticket reports are preserved. Transferred notes become visible to the target
        incident’s reporters. This action has no automatic undo.
      </Alert>
      {target && (
        <Typography variant="body2">
          Merge into #{target.id}: {target.title} ({target.status}).
        </Typography>
      )}
      {error && <Alert severity="error">{error}</Alert>}
      <Stack direction="row" spacing={2} sx={{ justifyContent: 'flex-end' }}>
        <Button disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button variant="contained" disabled={busy || !target} onClick={() => void save()}>
          {busy ? 'Merging…' : 'Merge incident'}
        </Button>
      </Stack>
    </Stack>
  )
  return embedded ? (
    <Box>{content}</Box>
  ) : (
    <Dialog
      open
      fullWidth
      maxWidth="sm"
      onClose={busy ? undefined : onClose}
      aria-labelledby="merge-title"
    >
      <DialogTitle id="merge-title">Merge incident #{source.id}</DialogTitle>
      <DialogContent sx={{ pt: '12px !important' }}>{content}</DialogContent>
    </Dialog>
  )
}
