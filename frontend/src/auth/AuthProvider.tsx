import { useEffect, useState, type ReactNode } from 'react'
import PropTypes from 'prop-types'
import { useQueryClient } from '@tanstack/react-query'
import { api, ApiError, errorMessage } from '../services/client'
import { getSession, sessionEvent, setSession } from '../services/session'
import type { TokenPair, User } from '../types'
import { AuthContext } from './context'
import { isTokenPair, isUser } from '../services/authContracts'

/** Restore a tab session, verify account capabilities and manage login/logout. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [user, setUser] = useState<User | null>(null)
  const [booting, setBooting] = useState(Boolean(getSession()))
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true
    if (getSession()) {
      api<User>('/auth/me', {}, true, isUser)
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
        queryClient.clear()
        setUser(null)
        setBooting(false)
      }
    }
    window.addEventListener(sessionEvent, handleSession)
    return () => {
      active = false
      window.removeEventListener(sessionEvent, handleSession)
    }
  }, [queryClient])

  const login = async (email: string, password: string) => {
    setNotice('')
    queryClient.clear()
    const tokens = await api<TokenPair>(
      '/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      },
      false,
      isTokenPair,
    )
    setSession(tokens)
    try {
      const account = await api<User>('/auth/me', {}, true, isUser)
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
    setUser(await api<User>('/auth/me', {}, true, isUser))
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
