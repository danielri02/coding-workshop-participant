import { useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import type { Field } from '../resources/forms'
import { formPayload, initialFormValues, validateField } from '../resources/forms'
import { ApiError, errorMessage } from '../services/client'
import type { FormRow, FormValues, Lookups } from '../types'

interface FormProps {
  title: string
  fields: Field[]
  lookups: Lookups
  row?: FormRow | null
  subtitle?: string
  submitLabel?: string
  embedded?: boolean
  onBusyChange?: (busy: boolean) => void
  onSave: (payload: Record<string, unknown>) => Promise<void>
  onClose: () => void
}

/** Render validated create/edit forms from resource metadata, including dependent selects. */
export function RecordFormDialog({
  title,
  fields,
  lookups,
  row = null,
  subtitle,
  submitLabel = 'Save',
  embedded = false,
  onBusyChange,
  onSave,
  onClose,
}: FormProps) {
  const baseFields = fields.filter((field) => !row || !field.createOnly)
  const [values, setValues] = useState<FormValues>(() => initialFormValues(baseFields, row))
  const visible = baseFields.filter((field) => !field.when || field.when(values))
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  useEffect(() => {
    onBusyChange?.(submitting)
    return () => onBusyChange?.(false)
  }, [submitting, onBusyChange])
  const payload = formPayload(visible, values, row)
  const invalid = visible.some((field) => validateField(field, values))
  const change = (field: Field, value: string | number | boolean) => {
    setValues((previous) => {
      const next = { ...previous, [field.name]: value }
      for (const name of field.resets || []) next[name] = ''
      return next
    })
    setServerErrors((previous) => ({ ...previous, [field.name]: '' }))
  }
  const save = async () => {
    if (submitting || invalid || !Object.keys(payload).length) return
    setSubmitting(true)
    setError('')
    try {
      await onSave(payload)
    } catch (failure) {
      setError(errorMessage(failure))
      if (failure instanceof ApiError) setServerErrors(failure.fields)
      setSubmitting(false)
    }
  }
  const content = (
    <>
      <DialogTitle id="record-form-title">{title}</DialogTitle>
      <DialogContent>
        <Stack
          component="form"
          id="record-form"
          spacing={2.5}
          sx={{ pt: 1 }}
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          {subtitle && (
            <Typography color="text.secondary" variant="body2">
              {subtitle}
            </Typography>
          )}
          {error && <Alert severity="error">{error}</Alert>}
          {visible.map((field) => {
            const disabled = submitting || Boolean(row && field.immutable)
            const fieldError =
              serverErrors[field.name] || (touched[field.name] ? validateField(field, values) : '')
            if (field.type === 'boolean')
              return (
                <FormControlLabel
                  key={field.name}
                  control={
                    <Switch
                      checked={Boolean(values[field.name])}
                      disabled={disabled}
                      onChange={(_, checked) => change(field, checked)}
                    />
                  }
                  label={field.label}
                />
              )
            const options = field.options?.(lookups, values) || []
            let helperText = field.helper || ''
            if (field.type === 'select' && !options.length && !helperText)
              helperText = 'No matching records. Create the parent record first.'
            if (row && field.immutable) helperText = 'Parent association cannot be changed.'
            if (fieldError) helperText = fieldError

            return (
              <TextField
                key={field.name}
                id={`field-${field.name}`}
                label={field.label}
                value={values[field.name] ?? ''}
                type={field.type === 'password' || field.type === 'email' ? field.type : 'text'}
                select={field.type === 'select'}
                multiline={field.type === 'multiline'}
                minRows={field.type === 'multiline' ? 3 : undefined}
                fullWidth
                required={Boolean(field.required || field.requiredWhen?.(values))}
                disabled={disabled}
                error={Boolean(fieldError)}
                autoComplete={field.type === 'password' ? 'new-password' : 'off'}
                helperText={helperText}
                onBlur={() => setTouched((previous) => ({ ...previous, [field.name]: true }))}
                onChange={(event) => change(field, event.target.value)}
                slotProps={{ htmlInput: { maxLength: field.maxLength } }}
              >
                {field.type === 'select' && !field.required && <MenuItem value="">None</MenuItem>}
                {options.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </TextField>
            )
          })}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button
          variant="contained"
          type="submit"
          form="record-form"
          disabled={submitting || invalid || !Object.keys(payload).length}
        >
          {submitting ? 'Saving…' : submitLabel}
        </Button>
      </DialogActions>
    </>
  )
  return embedded ? (
    <Box>{content}</Box>
  ) : (
    <Dialog
      open
      onClose={submitting ? undefined : onClose}
      maxWidth="sm"
      fullWidth
      aria-labelledby="record-form-title"
    >
      {content}
    </Dialog>
  )
}
