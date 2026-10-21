import { useState } from 'react'
import { Alert, Box, Button, Paper, Stack, TextField, Typography } from '@mui/material'
import ApartmentOutlined from '@mui/icons-material/ApartmentOutlined'
import ArrowForward from '@mui/icons-material/ArrowForward'
import { useAuth } from '../auth/context'
import { api, ApiError, errorMessage } from '../services/client'
import { isUser } from '../services/authContracts'
import { RecordFormDialog } from '../components/RecordFormDialog'
import { registrationFields } from '../resources/userFields'
import type { Lookups, User } from '../types'

const emptyLookups: Lookups = { users: [], buildings: [], floors: [], seats: [] }

/** Sign in or register an employee account with visible validation errors. */
export function LoginPage() {
  const { login, notice } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [registering, setRegistering] = useState(false)
  const [success, setSuccess] = useState('')
  const register = async (payload: Record<string, unknown>) => {
    let account: User
    try {
      account = await api<User>(
        '/users',
        { method: 'POST', body: JSON.stringify(payload) },
        false,
        isUser,
      )
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 409)
        throw new ApiError('An account with this email already exists. Sign in instead.', 409, {
          email: 'This email is already registered.',
        })
      throw failure
    }
    setEmail(account.email)
    setPassword('')
    setError('')
    setRegistering(false)
    setSuccess('Your account has been created. Sign in with your new password.')
  }
  const submit = async () => {
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      await login(email, password)
    } catch (failure) {
      setError(errorMessage(failure))
      setBusy(false)
    }
  }
  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
      }}
    >
      <Stack
        sx={{
          bgcolor: '#12253b',
          color: 'white',
          p: { xs: 4, md: 8, lg: 12 },
          justifyContent: 'space-between',
          gap: 6,
        }}
      >
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <ApartmentOutlined sx={{ fontSize: 32, color: '#80a9ff' }} />
          <Typography sx={{ fontWeight: 800, letterSpacing: 3 }}>ACME FACILITIES</Typography>
        </Stack>
        <Box>
          <Typography variant="overline" sx={{ color: '#89a7c5', letterSpacing: 2 }}>
            Workplace support
          </Typography>
          <Typography
            variant="h2"
            sx={{
              fontSize: { xs: 32, lg: 48 },
              maxWidth: 470,
              fontWeight: 700,
              lineHeight: 1.18,
              mt: 2,
            }}
          >
            A better workplace starts here.
          </Typography>
          <Typography sx={{ color: '#a6b9cd', mt: 3, maxWidth: 400, lineHeight: 1.8 }}>
            Report workplace issues, follow their progress, and stay in touch with facilities.
          </Typography>
        </Box>
        <Typography variant="caption" sx={{ color: '#7e98b2' }}>
          ACME Inc. · Facility management
        </Typography>
      </Stack>
      <Stack sx={{ justifyContent: 'center', alignItems: 'center', p: { xs: 3, md: 6 } }}>
        <Paper
          elevation={0}
          sx={{
            p: { xs: 3, sm: 5 },
            width: '100%',
            maxWidth: 470,
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 3,
          }}
        >
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            Welcome back
          </Typography>
          <Typography color="text.secondary" variant="body2" sx={{ mt: 1, mb: 4 }}>
            Sign in to your facilities workspace.
          </Typography>
          <Stack
            component="form"
            spacing={2.5}
            onSubmit={(event) => {
              event.preventDefault()
              void submit()
            }}
          >
            {success && <Alert severity="success">{success}</Alert>}
            {(error || (!success && notice)) && <Alert severity="error">{error || notice}</Alert>}
            <TextField
              label="Email address"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="username"
              required
              disabled={busy}
              autoFocus
              fullWidth
            />
            <TextField
              label="Password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
              disabled={busy}
              fullWidth
            />
            <Button
              type="submit"
              variant="contained"
              size="large"
              endIcon={!busy && <ArrowForward />}
              disabled={busy || !email.trim() || !password}
            >
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </Stack>
          <Button
            fullWidth
            disabled={busy}
            sx={{ mt: 2 }}
            onClick={() => {
              setError('')
              setSuccess('')
              setRegistering(true)
            }}
          >
            Create an account
          </Button>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 3, display: 'block' }}>
            Your account determines the workspace and actions available to you.
          </Typography>
        </Paper>
      </Stack>
      {registering && (
        <RecordFormDialog
          title="Create your account"
          subtitle="Use your ACME email to report workplace issues and follow their progress."
          fields={registrationFields}
          lookups={emptyLookups}
          onSave={register}
          onClose={() => setRegistering(false)}
          submitLabel="Create account"
        />
      )}
    </Box>
  )
}

LoginPage.propTypes = {}
