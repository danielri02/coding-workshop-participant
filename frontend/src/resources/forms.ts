import type { FormFieldName, FormValues, FormRow, Lookups, Option } from '../types'

/** Declarative input configuration shared by every create/edit dialog. */
export interface Field {
  name: FormFieldName
  label: string
  type?: 'text' | 'email' | 'password' | 'select' | 'boolean' | 'multiline'
  required?: boolean
  minLength?: number
  maxLength?: number
  numeric?: boolean
  createOnly?: boolean
  immutable?: boolean
  defaultValue?: string | number | boolean
  helper?: string
  resets?: FormFieldName[]
  options?: (lookups: Lookups, values: FormValues) => Option[]
  when?: (values: FormValues) => boolean
  requiredWhen?: (values: FormValues) => boolean
}

/** Choose only allowed fields and send changed values for partial updates. */
export function formPayload(
  fields: Field[],
  values: FormValues,
  row: FormRow | null,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  for (const field of fields) {
    if (row && (field.createOnly || field.immutable)) continue
    const raw = values[field.name]
    let value: string | number | boolean | null | undefined
    if (field.type === 'boolean') {
      value = Boolean(raw)
    } else if (field.numeric) {
      value = raw === '' ? null : Number(raw)
    } else if (field.type === 'password') {
      value = raw
    } else {
      value = String(raw ?? '').trim() || null
    }
    if (!row || (row[field.name] ?? null) !== value) payload[field.name] = value
  }
  return payload
}

/** Starting values for a create form or an existing row's edit form. */
export function initialFormValues(fields: Field[], row: FormRow | null): FormValues {
  const values: FormValues = {}
  for (const field of fields) {
    const value = row?.[field.name] ?? field.defaultValue ?? (field.type === 'boolean' ? false : '')
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      values[field.name] = value
    } else {
      values[field.name] = ''
    }
  }
  return values
}

/** Browser feedback mirrors the API rules; the server still validates every write. */
export function validateField(field: Field, values: FormValues): string {
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
