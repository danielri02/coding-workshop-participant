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

/** A whole-incident merge and a single-ticket correction use the same confirmation. */
export function IncidentTransferDialog({
  action,
  source,
  embedded = false,
  onClose,
  onSaved,
}: {
  action: 'merge' | 'reattach'
  source: AdminRow
  embedded?: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const merging = action === 'merge'
  const label = merging ? 'Merge incident' : 'Reattach ticket'
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
      await api(`/${merging ? 'incidents' : 'tickets'}/${source.id}/${action}`, {
        method: 'POST',
        body: JSON.stringify({ target_incident_id: target.id }),
      })
      onSaved()
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
          {label} #{source.id}
        </Typography>
      )}
      <Typography>
        {merging
          ? `Move all ${source.ticket_count ?? 0} tickets and all notes from “${source.title}” to the selected incident. Close this incident and retain a merge reference.`
          : `Move the report “${source.title}” from incident #${source.incident_id} to the selected incident.`}
      </Typography>
      <IncidentPicker
        id={target?.id || null}
        value={target}
        onChange={setTarget}
        excludeId={merging ? source.id : source.incident_id}
        mergeTargets
      />
      <Alert severity="warning">
        {merging
          ? 'The target keeps its location, category, priority, engineer and response-time milestones. Original ticket reports are preserved. Transferred notes become visible to the target incident’s reporters. This action has no automatic undo.'
          : 'The original report is preserved. Both incidents keep their notes and status, even if the source has no tickets left. The reporter will follow the target’s progress and see its shared description and notes. Review those before confirming.'}
      </Alert>
      {target && (
        <Typography variant="body2">
          {merging ? 'Merge into' : 'Attach to'} #{target.id}: {target.title} ({target.status}).
        </Typography>
      )}
      {error && <Alert severity="error">{error}</Alert>}
      <Stack direction="row" spacing={2} sx={{ justifyContent: 'flex-end' }}>
        <Button disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button variant="contained" disabled={busy || !target} onClick={() => void save()}>
          {busy ? 'Saving…' : label}
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
      aria-labelledby="transfer-title"
    >
      <DialogTitle id="transfer-title">
        {label} #{source.id}
      </DialogTitle>
      <DialogContent sx={{ pt: '12px !important' }}>{content}</DialogContent>
    </Dialog>
  )
}
