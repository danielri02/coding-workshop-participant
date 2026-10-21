import { createContext, useContext } from 'react'
import type { User } from '../types'

/** Authentication operations and the server-verified current account. */
export interface AuthState {
  user: User | null
  booting: boolean
  notice: string
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
  setAccount: (account: User) => void
}

export const AuthContext = createContext<AuthState | null>(null)

/** Read the authenticated account inside the application provider. */
export function useAuth(): AuthState {
  const context = useContext(AuthContext)
  if (!context) throw new Error('AuthProvider is required')
  return context
}
