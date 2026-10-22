import { useWorkspace } from '../hooks/useWorkspace'
import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Box, Button, Dialog, DialogContent, DialogTitle, Stack } from '@mui/material'
import ArrowBack from '@mui/icons-material/ArrowBack'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { RecordFormDialog } from '../components/RecordFormDialog'
import { useLookups } from '../hooks/useLookups'
import { useResourceActions } from '../hooks/useResourceActions'
import { resources } from '../resources/definitions'
import { invalidateResourceQueries } from '../services/queries'
import { IncidentDetailsPage } from '../incidents/IncidentDetailsPage'
import { useRecordDialogs } from './context'
import { targetKey, type DialogEntry } from './navigation'
import { TicketDetailsPage } from '../incidents/TicketDetailsPage'
import { MergeIncidentDialog } from '../components/MergeIncidentDialog'
import { RecordDetailsContent } from './RecordDetailsContent'
import { RelatedGrid } from './RelatedGrid'

function DialogScreen({ entry }: { entry: DialogEntry }) {
  const { target } = entry
  const { adminView, workspace } = useWorkspace()
  const navigation = useRecordDialogs()
  const { setBusy } = navigation
  const client = useQueryClient()
  const resource = resources.find((item) => item.key === target.resource)!
  const lookups = useLookups({
    lookups: resource.lookups.filter((key) => key !== 'users' || adminView),
  })
  const scope = target.kind === 'collection' ? target.filters.incident_id || 0 : 0
  const actions = useResourceActions(resource, scope, (message, key) => {
    void invalidateResourceQueries(client, key || resource.key)
    if (target.kind === 'record' && message.endsWith('deleted.')) navigation.close()
  })
  useEffect(() => {
    if (actions.confirmation) setBusy(actions.busy)
    return () => setBusy(false)
  }, [actions.confirmation, actions.busy, setBusy])
  if (actions.merge)
    return (
      <MergeIncidentDialog
        embedded
        source={actions.merge}
        onClose={() => actions.setMerge(null)}
        onMerged={actions.mergeSaved}
      />
    )
  if (actions.editor)
    return (
      <RecordFormDialog
        embedded
        key={`${actions.editor.action}:${actions.editor.row?.id || 'new'}`}
        title={actions.formTitle}
        fields={actions.fields}
        row={actions.formRow}
        lookups={lookups.data}
        onSave={actions.save}
        onClose={() => actions.setEditor(null)}
        onBusyChange={navigation.setBusy}
      />
    )
  if (actions.confirmation)
    return (
      <ConfirmDialog
        embedded
        title={actions.confirmationTitle}
        description={actions.confirmationDescription}
        confirmDisabled={!actions.confirmationReady}
        busy={actions.busy}
        error={actions.error}
        onClose={() => actions.setConfirmation(null)}
        onConfirm={() => void actions.confirm()}
      />
    )
  if (target.kind === 'collection')
    return (
      <RelatedGrid
        target={target}
        state={entry.state}
        onAction={(command, row) =>
          command === 'create'
            ? actions.setEditor({ action: 'create', row: null })
            : actions.action(command, row)
        }
      />
    )
  if (target.resource === 'tickets') return <TicketDetailsPage recordId={target.id} embedded />
  if (!adminView && target.resource === 'incidents')
    return (
      <IncidentDetailsPage
        recordId={target.id}
        scope={target.scope || (workspace?.id === 'assigned' ? 'assigned' : undefined)}
        embedded
      />
    )
  return (
    <RecordDetailsContent
      resource={resource}
      id={target.id}
      label={target.label}
      lookups={lookups.data}
      onAction={actions.action}
    />
  )
}

/** One modal surface replaces its content while retaining its origin and Back history. */
export function RecordDialogHost() {
  const { entries, close, back, busy } = useRecordDialogs()
  const entry = entries[entries.length - 1]
  const titleRef = useRef<HTMLHeadingElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const key = targetKey(entry.target)
  useEffect(() => {
    titleRef.current?.focus()
    contentRef.current?.scrollTo({ top: 0, left: 0 })
  }, [key, entries.length])
  const resource = resources.find((item) => item.key === entry.target.resource)!
  const title =
    entry.target.kind === 'collection'
      ? entry.target.title
      : `${resource.singular[0].toUpperCase() + resource.singular.slice(1)} #${entry.target.id}`
  return (
    <Dialog
      open
      onClose={busy ? undefined : close}
      maxWidth="lg"
      fullWidth
      aria-labelledby="record-dialog-title"
      slotProps={{
        paper: {
          sx: {
            m: { xs: 1, sm: 4 },
            width: { xs: 'calc(100% - 16px)', sm: 'calc(100% - 64px)' },
            maxHeight: 'calc(100dvh - 16px)',
          },
        },
      }}
    >
      <Stack
        direction="row"
        sx={{
          alignItems: 'center',
          px: 2,
          gap: 1,
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        {entries.length > 1 && (
          <Button startIcon={<ArrowBack />} disabled={busy} onClick={back}>
            Back
          </Button>
        )}
        <DialogTitle
          ref={titleRef}
          tabIndex={-1}
          id="record-dialog-title"
          sx={{ flex: 1, px: 1, minWidth: 0, overflowWrap: 'anywhere' }}
        >
          {title}
        </DialogTitle>
        <Button onClick={close} disabled={busy}>
          Close
        </Button>
      </Stack>
      <DialogContent ref={contentRef} sx={{ p: { xs: 2, sm: 3 }, minWidth: 0 }}>
        <Box key={`${entries.length}:${targetKey(entry.target)}`}>
          <DialogScreen entry={entry} />
        </Box>
      </DialogContent>
    </Dialog>
  )
}
