import { Box, CircularProgress } from '@mui/material'
import { BrowserRouter, Navigate, useLocation } from 'react-router-dom'
import { lazy, Suspense, useState } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createQueryClient } from './services/queries'
import { AuthProvider } from './auth/AuthProvider'
import { useAuth } from './auth/context'
import { LoginPage } from './pages/LoginPage'
import { availableWorkspaces, workspaceForPath } from './auth/workspaces'
const AdminRoutes = lazy(() => import('./pages/AdminRoutes'))
const MemberRoutes = lazy(() => import('./pages/MemberRoutes'))

/** Route each server-verified account to its permitted workspace. */
export function Application() {
  const { user, booting } = useAuth()
  const { pathname } = useLocation()
  if (booting)
    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <CircularProgress aria-label="Restoring session" />
      </Box>
    )
  if (!user) return <LoginPage />
  const workspace = workspaceForPath(user, pathname)
  if (!workspace) return <Navigate to={availableWorkspaces(user)[0].path} replace />
  return workspace.id === 'admin' ? <AdminRoutes /> : <MemberRoutes />
}

Application.propTypes = {}

/** Compose the router and shared authentication boundary for the application. */
function App() {
  const [queryClient] = useState(createQueryClient)
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Suspense
            fallback={
              <Box sx={{ p: 4 }}>
                <CircularProgress aria-label="Loading workspace" />
              </Box>
            }
          >
            <Application />
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}

App.propTypes = {}
export default App
