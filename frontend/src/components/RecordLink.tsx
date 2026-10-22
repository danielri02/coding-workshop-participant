import type { ReactNode } from 'react'
import { Link } from '@mui/material'
import type { ResourceKey } from '../types'
import { useRecordDialogs } from '../dialogs/context'
import type { IncidentScope } from '../incidents/scope'

/** Open a referenced record without requiring a search in its CRUD grid. */
export function RecordLink({
  resource,
  id,
  children,
  tabIndex,
  scope,
}: {
  resource: ResourceKey
  id: number
  children: ReactNode
  tabIndex?: number
  scope?: IncidentScope
}) {
  const { openRecord } = useRecordDialogs()
  return (
    <Link
      component="button"
      type="button"
      role="link"
      sx={{ font: 'inherit', textAlign: 'inherit', verticalAlign: 'baseline' }}
      tabIndex={tabIndex}
      onClick={(event) => {
        event.stopPropagation()
        openRecord(resource, id, {
          scope,
          label: typeof children === 'string' ? children : undefined,
        })
      }}
    >
      {children}
    </Link>
  )
}
