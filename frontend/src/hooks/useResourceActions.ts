import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useApiQuery } from './useApiQuery'
import { deletionWarning } from '../resources/deletion'
import { useRecordDialogs } from '../dialogs/context'
import { useAuth } from '../auth/context'
import type { AdminOutlet } from '../components/AdminLayout'
import type { RowAction } from '../components/ResourceGrid'
import type { ResourceDefinition } from '../resources/definitions'
import { editorForm, type Editor } from '../resources/incidentActions'
import { api, errorMessage } from '../services/client'
import { isUser } from '../services/authContracts'
import type { AdminRow, ApiRecord, DeletionPreview, User } from '../types'

/** Own mutations and dialog state without coupling them to grid presentation. */
export function useResourceActions(
  resource: ResourceDefinition,
  scope: number,
  changed: AdminOutlet['changed'],
) {
  const { user, setAccount, logout, refreshUser } = useAuth()
  const client = useQueryClient()
  const { openRecord, openCollection } = useRecordDialogs()
  const title = resource.singular[0].toUpperCase() + resource.singular.slice(1)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [confirmation, setConfirmation] = useState<{
    action: 'delete' | 'admin'
    row: AdminRow
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const previewPath =
    confirmation?.action === 'delete'
      ? `/deletions${resource.endpoint}/${confirmation.row.id}`
      : null
  const preview = useApiQuery<DeletionPreview | null>(previewPath, null)
  let confirmationReady = true
  let confirmationTitle = ''
  let confirmationDescription = ''
  if (confirmation?.action === 'delete') {
    confirmationTitle = `Delete ${resource.singular}?`
    confirmationReady = Boolean(
      !preview.loading &&
      !preview.error &&
      preview.data &&
      preview.data.resource === resource.endpoint.slice(1) &&
      preview.data.record_id === confirmation.row.id,
    )
    confirmationDescription = 'Loading the records affected by this deletion…'
    if (confirmationReady && preview.data) confirmationDescription = deletionWarning(preview.data)
  } else if (confirmation?.action === 'admin') {
    confirmationTitle = confirmation.row.is_admin ? 'Remove admin access?' : 'Grant admin access?'
    confirmationDescription = `Change administrator access for ${String(confirmation.row.name)}?`
    if (confirmation.row.id === user?.id && confirmation.row.is_admin)
      confirmationDescription += ' Your account will leave the admin workspace.'
  }

  const action = useCallback(
    (command: RowAction, row: AdminRow) => {
      setError('')
      if (command === 'notes')
        openCollection('notes', { incident_id: row.id }, `Notes for incident #${row.id}`)
      else if (command === 'view') openRecord(resource.key, row.id)
      else if (command === 'delete' || command === 'admin')
        setConfirmation({ action: command, row })
      else setEditor({ action: command, row })
    },
    [openCollection, openRecord, resource.key],
  )

  const save = async (payload: Record<string, unknown>) => {
    if (!editor) return
    const creating = editor.action === 'create'
    let endpoint = resource.endpoint
    if (creating) {
      if (resource.key === 'notes') endpoint = `/incidents/${scope}/notes`
    } else {
      endpoint += `/${editor.row?.id}`
      if (['assignment', 'priority', 'status'].includes(editor.action))
        endpoint += `/${editor.action}`
    }
    const options = {
      method: creating ? 'POST' : 'PATCH',
      body: JSON.stringify(payload),
    }
    if (resource.key === 'users') {
      const saved = await api<User>(endpoint, options, true, isUser)
      if (saved.id === user?.id) setAccount(saved)
    } else await api<ApiRecord>(endpoint, options)
    setEditor(null)
    changed(`${title} ${creating ? 'created' : 'updated'}.`, resource.key)
  }

  const confirm = async () => {
    if (!confirmation || !confirmationReady) return
    setBusy(true)
    setError('')
    try {
      const { row, action: command } = confirmation
      if (command === 'delete')
        await api<void>(
          `${resource.endpoint}/${row.id}?confirmation=${preview.data!.confirmation_token}`,
          { method: 'DELETE' },
        )
      else {
        const saved = await api<User>(
          `/users/${row.id}/admin`,
          {
            method: 'PATCH',
            body: JSON.stringify({ is_admin: !row.is_admin }),
          },
          true,
          isUser,
        )
        if (row.id === user?.id) setAccount(saved)
      }
      setConfirmation(null)
      changed(command === 'delete' ? `${title} deleted.` : 'Admin access updated.', resource.key)
      if (resource.key === 'users' && row.id === user?.id) {
        if (command === 'delete') await logout()
      }
      if (command === 'delete' && resource.key === 'engineers' && row.id === user?.id)
        await refreshUser()
    } catch (failure) {
      setError(errorMessage(failure))
      if (previewPath) void client.invalidateQueries({ queryKey: ['api', previewPath] })
    } finally {
      setBusy(false)
    }
  }

  return {
    user,
    editor,
    setEditor,
    confirmation,
    setConfirmation,
    busy,
    error: error || (confirmation?.action === 'delete' ? preview.error : ''),
    confirmationReady,
    confirmationTitle,
    confirmationDescription,
    action,
    save,
    confirm,
    ...editorForm(resource, editor),
  }
}
