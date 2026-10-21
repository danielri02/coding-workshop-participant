import { useEffect, useState, type ReactNode } from 'react'
import PropTypes from 'prop-types'
import { api, ApiError, errorMessage } from '../services/client'
import { getSession, sessionEvent, setSession } from '../services/session'
import type { TokenPair, User } from '../types'
import { AuthContext } from './context'

/** Restore a tab session, verify admin capabilities and manage login/logout. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [booting, setBooting] = useState(Boolean(getSession()))
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true
    if (getSession()) {
      api<User>('/auth/me')
        .then(
          (account) => {
            if (active) setUser(account)
          },
          (error: unknown) => {
            if (active) {
              if (error instanceof ApiError && error.status === 401) {
                setSession(null)
                setNotice('Your session has expired. Please sign in again.')
              } else
                setNotice(
                  `${errorMessage(error)} Refresh this page to retry your existing session.`,
                )
            }
          },
        )
        .finally(() => {
          if (active) setBooting(false)
        })
    }
    const handleSession = () => {
      if (!getSession()) {
        setUser(null)
        setBooting(false)
      }
    }
    window.addEventListener(sessionEvent, handleSession)
    return () => {
      active = false
      window.removeEventListener(sessionEvent, handleSession)
    }
  }, [])

  const login = async (email: string, password: string) => {
    setNotice('')
    const tokens = await api<TokenPair>(
      '/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      },
      false,
    )
    setSession(tokens)
    try {
      const account = await api<User>('/auth/me')
      if (!account.is_admin) {
        await api(
          '/auth/logout',
          { method: 'POST', body: JSON.stringify({ refresh_token: tokens.refresh_token }) },
          false,
        )
        throw new ApiError(
          'This workspace requires Facility Admin access. Sign in with an admin account.',
          403,
        )
      }
      setUser(account)
    } catch (error) {
      setSession(null)
      throw error
    }
  }

  const logout = async () => {
    const tokens = getSession()
    setSession(null)
    setUser(null)
    if (tokens) {
      try {
        await api(
          '/auth/logout',
          { method: 'POST', body: JSON.stringify({ refresh_token: tokens.refresh_token }) },
          false,
        )
      } catch {
        setNotice(
          'Signed out on this browser. The server could not be reached to revoke the login.',
        )
      }
    }
  }

  const refreshUser = async () => {
    setUser(await api<User>('/auth/me'))
  }

  return (
    <AuthContext.Provider
      value={{ user, booting, notice, login, logout, refreshUser, setAccount: setUser }}
    >
      {children}
    </AuthContext.Provider>
  )
}

AuthProvider.propTypes = { children: PropTypes.node.isRequired }
