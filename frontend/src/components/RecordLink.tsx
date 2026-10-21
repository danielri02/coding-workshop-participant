import type { ReactNode } from 'react'
import { Link } from '@mui/material'
import { Link as RouterLink } from 'react-router-dom'
import type { ResourceKey } from '../types'

/** Open a referenced record without requiring a search in its CRUD grid. */
export function RecordLink({
  resource,
  id,
  children,
  tabIndex,
}: {
  resource: ResourceKey
  id: number
  children: ReactNode
  tabIndex?: number
}) {
  return (
    <Link
      component={RouterLink}
      to={`/admin/${resource}?record=${id}`}
      tabIndex={tabIndex}
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </Link>
  )
}
