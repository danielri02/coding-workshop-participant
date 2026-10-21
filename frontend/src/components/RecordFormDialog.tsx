import { useState } from 'react'
import {
  Alert,
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
import PropTypes from 'prop-types'
import type { Field } from '../resources/forms'
import { formPayload } from '../resources/forms'
import { ApiError, errorMessage } from '../services/client'
import type { FormRow, FormValues, Lookups } from '../types'

interface FormProps {
  title: string
  fields: Field[]
  lookups: Lookups
  row?: FormRow | null
  subtitle?: string
  onSave: (payload: Record<string, unknown>) => Promise<void>
  onClose: () => void
}

function validate(field: Field, values: FormValues): string {
  if (field.type === 'boolean') return ''
  const raw = String(values[field.name] ?? '')
  const value = field.type === 'password' ? raw : raw.trim()
  if ((field.required || field.requiredWhen?.(values)) && !value.trim())
    return `${field.label} is required.`
  if (!value) return ''
  if (field.minLength && value.length < field.minLength)
    return `Use at least ${field.minLength} characters.`
  if (field.maxLength && value.length > field.maxLength)
    return `Use no more than ${field.maxLength} characters.`
  if (field.type === 'email' && !/^[^\s@]+@acme\.inc$/i.test(value))
    return 'Use a valid @acme.inc email address.'
  return ''
}

/** Render validated create/edit forms from resource metadata, including dependent selects. */
export function RecordFormDialog({
  title,
  fields,
  lookups,
  row = null,
  subtitle,
  onSave,
  onClose,
}: FormProps) {
  const baseFields = fields.filter((field) => !row || !field.createOnly)
  const [values, setValues] = useState<FormValues>(() =>
    Object.fromEntries(
      baseFields.map((field) => {
        const value =
          row?.[field.name] ?? field.defaultValue ?? (field.type === 'boolean' ? false : '')
        return [
          field.name,
          typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
            ? value
            : '',
        ]
      }),
    ),
  )
  const visible = baseFields.filter((field) => !field.when || field.when(values))
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const payload = formPayload(visible, values, row)
  const invalid = visible.some((field) => validate(field, values))
  const change = (field: Field, value: string | number | boolean) => {
    setValues((previous) => ({
      ...previous,
      [field.name]: value,
      ...Object.fromEntries((field.resets || []).map((name) => [name, ''])),
    }))
    setServerErrors((previous) => ({ ...previous, [field.name]: '' }))
  }
  const save = async () => {
    if (invalid || !Object.keys(payload).length) return
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
  return (
    <Dialog
      open
      onClose={submitting ? undefined : onClose}
      maxWidth="sm"
      fullWidth
      aria-labelledby="record-form-title"
    >
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
              serverErrors[field.name] || (touched[field.name] ? validate(field, values) : '')
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
                helperText={
                  fieldError ||
                  (row && field.immutable
                    ? 'Parent association cannot be changed.'
                    : field.helper ||
                      (field.type === 'select' && !options.length
                        ? 'No matching records. Create the parent record first.'
                        : ''))
                }
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
          {submitting ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

RecordFormDialog.propTypes = {
  title: PropTypes.string.isRequired,
  fields: PropTypes.array.isRequired,
  lookups: PropTypes.object.isRequired,
  row: PropTypes.object,
  subtitle: PropTypes.string,
  onSave: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
}
