import { useLocation } from 'react-router-dom'
import { useAuth } from '../auth/context'
import { workspaceForPath } from '../auth/workspaces'

/** Keep presentation mode separate from the server-verified capabilities. */
export function useWorkspace() {
  const { user } = useAuth()
  const { pathname } = useLocation()
  const workspace = user ? workspaceForPath(user, pathname) : undefined
  return { workspace, adminView: workspace?.id === 'admin' }
}
