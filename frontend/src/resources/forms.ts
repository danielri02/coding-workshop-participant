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
    const value =
      field.type === 'boolean'
        ? Boolean(raw)
        : field.numeric
          ? raw === ''
            ? null
            : Number(raw)
          : field.type === 'password'
            ? raw
            : String(raw ?? '').trim() || null
    if (!row || (row[field.name] ?? null) !== value) payload[field.name] = value
  }
  return payload
}
