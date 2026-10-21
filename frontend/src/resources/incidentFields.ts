import { categories, priorities, constraints } from '../generated/domain'
import type { Field } from './forms'
import type { Option } from '../types'

const choices = (values: readonly string[]): Option[] =>
  values.map((value) => ({ value, label: value }))

/** Shared incident inputs; authorization remains on the API. */
export const locationFields: Field[] = [
  {
    name: 'building_id',
    label: 'Building',
    type: 'select',
    required: true,
    numeric: true,
    resets: ['floor_id', 'seat_id'],
    options: (data) => data.buildings.map((row) => ({ value: row.id, label: String(row.name) })),
  },
  {
    name: 'floor_id',
    label: 'Floor',
    type: 'select',
    numeric: true,
    resets: ['seat_id'],
    options: (data, values) =>
      data.floors
        .filter((row) => row.building_id === Number(values.building_id))
        .map((row) => ({ value: row.id, label: `Floor ${String(row.label)}` })),
  },
  {
    name: 'seat_id',
    label: 'Seat',
    type: 'select',
    numeric: true,
    options: (data, values) =>
      data.seats
        .filter((row) => row.floor_id === Number(values.floor_id))
        .map((row) => ({ value: row.id, label: String(row.label) })),
  },
]

export const incidentFields: Field[] = [
  { name: 'title', label: 'Title', required: true, ...constraints.IncidentCreate.title },
  {
    name: 'description',
    label: 'Description',
    type: 'multiline',
    required: true,
    ...constraints.IncidentCreate.description,
  },
  {
    name: 'category',
    label: 'Category',
    type: 'select',
    required: true,
    options: () => choices(categories),
  },
  ...locationFields,
  {
    name: 'priority',
    label: 'Priority',
    type: 'select',
    required: true,
    defaultValue: 'Medium',
    createOnly: true,
    options: () => choices(priorities),
  },
  {
    name: 'escalation_reason',
    label: 'Escalation reason',
    type: 'multiline',
    ...constraints.IncidentCreate.escalation_reason,
    createOnly: true,
  },
]

export const noteFields: Field[] = [
  {
    name: 'body',
    label: 'Note',
    type: 'multiline',
    required: true,
    ...constraints.NoteCreate.body,
  },
]
