import { constraints, priorities, transitions } from '../generated/domain'
import type { AdminRow, FormRow } from '../types'
import type { ResourceDefinition } from './definitions'
import type { Field } from './forms'

export type Editor = {
  action: 'create' | 'edit' | 'assignment' | 'priority' | 'status'
  row: AdminRow | null
}

/** Keep operation-specific input rules separate from page orchestration. */
export function editorForm(resource: ResourceDefinition, editor: Editor | null) {
  let fields: Field[] = resource.fields
  let formRow: FormRow | null = editor?.row || null
  if (editor?.action === 'assignment')
    fields = [
      {
        name: 'assignee_id',
        label: 'Assigned engineer',
        type: 'select',
        numeric: true,
        helper: 'Choose None to leave this incident unassigned.',
        options: (data) =>
          data.users
            .filter((row) => row.engineer_profile)
            .map((row) => ({ value: row.id, label: String(row.name) })),
      },
    ]
  if (editor?.action === 'priority')
    fields = [
      {
        name: 'priority',
        label: 'Priority',
        type: 'select',
        required: true,
        options: () => priorities.map((value) => ({ value, label: value })),
      },
      {
        name: 'escalation_reason',
        label: 'Escalation reason',
        type: 'multiline',
        ...constraints.IncidentPriorityUpdate.escalation_reason,
        helper: 'A reason marks this incident as escalated. Clear it to remove escalation.',
      },
    ]
  if (editor?.action === 'status') {
    const next = editor.row?.status ? transitions[editor.row.status] : []
    fields = [
      {
        name: 'status',
        label: 'Next status',
        type: 'select',
        required: true,
        options: () => next.map((value) => ({ value, label: value })),
      },
      {
        name: 'blocked_reason',
        label: 'Blocked reason',
        type: 'multiline',
        ...constraints.IncidentStatusUpdate.blocked_reason,
        when: (values) => values.status === 'Blocked',
        requiredWhen: (values) => values.status === 'Blocked',
      },
    ]
    formRow = editor.row ? { ...editor.row, status: '', blocked_reason: '' } : null
  }
  const formTitle =
    editor?.action === 'create'
      ? `New ${resource.singular}`
      : editor?.action === 'edit'
        ? `Edit ${resource.singular}`
        : editor?.action === 'assignment'
          ? 'Assign engineer'
          : editor?.action === 'priority'
            ? 'Priority and escalation'
            : 'Change status'

  return { fields, formRow, formTitle }
}
