import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@mui/material'
import PropTypes from 'prop-types'

interface ConfirmProps {
  title: string
  description: string
  busy: boolean
  error: string
  onConfirm: () => void
  onClose: () => void
  embedded?: boolean
  confirmDisabled?: boolean
}

/** Confirm a concrete deletion or capability change and preserve failures for retry. */
export function ConfirmDialog({
  title,
  description,
  busy,
  error,
  onConfirm,
  onClose,
  embedded = false,
  confirmDisabled = false,
}: ConfirmProps) {
  const content = (
    <>
      <DialogTitle id="confirm-title">{title}</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <DialogContentText sx={{ whiteSpace: 'pre-line' }}>{description}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color="error"
          onClick={onConfirm}
          disabled={busy || confirmDisabled}
        >
          {busy ? 'Working…' : 'Confirm'}
        </Button>
      </DialogActions>
    </>
  )
  return embedded ? (
    <Box>{content}</Box>
  ) : (
    <Dialog
      open
      onClose={busy ? undefined : onClose}
      maxWidth="xs"
      fullWidth
      aria-labelledby="confirm-title"
    >
      {content}
    </Dialog>
  )
}

ConfirmDialog.propTypes = {
  title: PropTypes.string.isRequired,
  description: PropTypes.string.isRequired,
  busy: PropTypes.bool.isRequired,
  error: PropTypes.string.isRequired,
  onConfirm: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
  embedded: PropTypes.bool,
  confirmDisabled: PropTypes.bool,
}
