import { constraints } from '../generated/domain'
import type { Field } from './forms'

/** Share public account inputs between registration and administrator creation. */
export const userFields: Field[] = [
  { name: 'name', label: 'Name', required: true, ...constraints.UserCreate.name },
  {
    name: 'email',
    label: 'Email',
    type: 'email',
    required: true,
    ...constraints.UserCreate.email,
    helper: 'Use an @acme.inc email address.',
  },
  {
    name: 'password',
    label: 'Initial password',
    type: 'password',
    required: true,
    ...constraints.UserCreate.password,
    createOnly: true,
    helper: '12–128 characters.',
  },
]

export const registrationFields = userFields.map((field) =>
  field.name === 'password' ? { ...field, label: 'Password' } : field,
)
