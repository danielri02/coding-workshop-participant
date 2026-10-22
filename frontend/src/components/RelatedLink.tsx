import type { ReactNode } from 'react'
import { Link } from '@mui/material'
import { useRecordDialogs } from '../dialogs/context'
import type { RelatedFilters } from '../dialogs/navigation'
import type { ResourceKey } from '../types'

export function RelatedLink({
  resource,
  filters,
  title,
  children,
  tabIndex,
}: {
  resource: ResourceKey
  filters: RelatedFilters
  title: string
  children: ReactNode
  tabIndex?: number
}) {
  const { openCollection } = useRecordDialogs()
  return (
    <Link
      component="button"
      type="button"
      role="link"
      tabIndex={tabIndex}
      sx={{ font: 'inherit', textAlign: 'inherit' }}
      onClick={(event) => {
        event.stopPropagation()
        openCollection(resource, filters, title)
      }}
    >
      {children}
    </Link>
  )
}
