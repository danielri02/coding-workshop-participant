import { createContext, useContext } from 'react'
import type { IncidentScope } from '../incidents/scope'
import type { ResourceKey } from '../types'
import type { DialogEntry, DialogTarget, RelatedFilters } from './navigation'

export interface DialogNavigation {
  openRecord: (
    resource: ResourceKey,
    id: number,
    options?: { label?: string; scope?: IncidentScope },
  ) => void
  openCollection: (resource: ResourceKey, filters: RelatedFilters, title: string) => void
  open: (target: DialogTarget) => void
  back: () => void
  close: () => void
  setState: (state: Partial<DialogEntry['state']>) => void
  setBusy: (busy: boolean) => void
  busy: boolean
  entries: DialogEntry[]
}

export const DialogContext = createContext<DialogNavigation | null>(null)
export function useRecordDialogs(): DialogNavigation {
  const navigation = useContext(DialogContext)
  if (!navigation) throw new Error('Record links require a dialog provider')
  return navigation
}
