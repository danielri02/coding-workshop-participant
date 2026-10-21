import { Alert, Box, Button, CircularProgress, Stack } from '@mui/material'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthProvider'
import { useAuth } from './auth/context'
import { AdminLayout } from './components/AdminLayout'
import { LoginPage } from './pages/LoginPage'
import { ResourcePage } from './pages/ResourcePage'
import { resources } from './resources/definitions'

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
  return (
    <Routes>
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<Navigate to="incidents" replace />} />
        {resources.map((resource) => (
          <Route
            key={resource.key}
            path={resource.key}
            element={<ResourcePage key={resource.key} resource={resource} />}
          />
        ))}
      </Route>
      <Route path="*" element={<Navigate to="/admin/incidents" replace />} />
    </Routes>
  )
}

AdminApplication.propTypes = {}

/** Compose the router and shared authentication boundary for the admin application. */
function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AdminApplication />
      </AuthProvider>
    </BrowserRouter>
  )
}

App.propTypes = {}
export default App
