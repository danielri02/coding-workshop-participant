import { useAuth } from '../auth/context'
import { RecordLink } from './RecordLink'

/** Names remain readable when the actor cannot open that person's account. */
export function PersonLink({
  id,
  name,
  tabIndex,
}: {
  id: number
  name: string
  tabIndex?: number
}) {
  const { user } = useAuth()
  return user?.is_admin || user?.id === id ? (
    <RecordLink resource="users" id={id} tabIndex={tabIndex}>
      {name}
    </RecordLink>
  ) : (
    <>{name}</>
  )
}
