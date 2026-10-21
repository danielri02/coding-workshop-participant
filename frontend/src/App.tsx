import { Alert, Box, Button, CircularProgress, Stack } from '@mui/material'
import { BrowserRouter } from 'react-router-dom'
import { lazy, Suspense, useState } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createQueryClient } from './services/queries'
import { AuthProvider } from './auth/AuthProvider'
import { useAuth } from './auth/context'
import { LoginPage } from './pages/LoginPage'
const AdminRoutes = lazy(() => import('./pages/AdminRoutes'))

/** Protect admin pages using the current account verified by the backend. */
function AdminApplication() {
  const { user, booting, logout } = useAuth()
  if (booting)
    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <CircularProgress aria-label="Restoring session" />
      </Box>
    )
  if (!user) return <LoginPage />
  if (!user.is_admin)
    return (
      <Stack spacing={3} sx={{ maxWidth: 500, mx: 'auto', my: 10, p: 3 }}>
        <Alert severity="warning">Facility Admin access is required for this workspace.</Alert>
        <Button variant="contained" onClick={() => void logout()}>
          Sign out
        </Button>
      </Stack>
    )
  return <AdminRoutes />
}

AdminApplication.propTypes = {}

/** Compose the router and shared authentication boundary for the admin application. */
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
            <AdminApplication />
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}

App.propTypes = {}
export default App
