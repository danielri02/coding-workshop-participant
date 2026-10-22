import { expect, test } from 'vitest'
import { formPayload, initialFormValues, validateField, type Field } from '../src/resources/forms'

const fields: Field[] = [
  { name: 'name', label: 'Name', required: true, minLength: 2, maxLength: 10 },
  { name: 'is_available', label: 'Available', type: 'boolean', defaultValue: true },
  { name: 'building_id', label: 'Building', numeric: true, immutable: true },
]

test('edit defaults preserve false and zero while supplying defaults for missing fields', () => {
  expect(
    initialFormValues(fields, { name: 'Office', is_available: false, building_id: 0 }),
  ).toEqual({
    name: 'Office',
    is_available: false,
    building_id: 0,
  })
  expect(initialFormValues(fields, null)).toEqual({ name: '', is_available: true, building_id: '' })
})

test('an edited checkbox sends false while unchanged fields and immutable parents stay out of PATCH', () => {
  const original = { name: 'Office', is_available: true, building_id: 9 }
  expect(
    formPayload(fields, { name: ' Office ', is_available: false, building_id: 12 }, original),
  ).toEqual({ is_available: false })
})

test('a dependent required field is validated only when its condition is met', () => {
  const blocked: Field = {
    name: 'blocked_reason',
    label: 'Blocked reason',
    requiredWhen: (values) => values.status === 'Blocked',
  }
  expect(validateField(blocked, { status: 'In Progress', blocked_reason: '' })).toBe('')
  expect(validateField(blocked, { status: 'Blocked', blocked_reason: '  ' })).toBe(
    'Blocked reason is required.',
  )
  expect(validateField(blocked, { status: 'Blocked', blocked_reason: 'Waiting for a part' })).toBe(
    '',
  )
})

test('browser validation trims ordinary text but preserves password spaces for length checking', () => {
  expect(validateField(fields[0], { name: '   ' })).toBe('Name is required.')
  expect(validateField(fields[0], { name: ' A ' })).toBe('Use at least 2 characters.')
  expect(validateField(fields[0], { name: 'Long office name' })).toBe(
    'Use no more than 10 characters.',
  )
  expect(
    validateField(
      { name: 'password', label: 'Password', type: 'password', minLength: 8 },
      { password: ' abcdef ' },
    ),
  ).toBe('')
  expect(
    validateField({ name: 'email', label: 'Email', type: 'email' }, { email: 'Person@ACME.INC' }),
  ).toBe('')
  expect(
    validateField(
      { name: 'email', label: 'Email', type: 'email' },
      { email: 'person@acme.inc.invalid' },
    ),
  ).toBe('Use a valid @acme.inc email address.')
})
