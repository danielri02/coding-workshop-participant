import { useState } from 'react'
import { Alert, Box, Button, Paper, Stack, TextField, Typography } from '@mui/material'
import ApartmentOutlined from '@mui/icons-material/ApartmentOutlined'
import ArrowForward from '@mui/icons-material/ArrowForward'
import { useAuth } from '../auth/context'
import { errorMessage } from '../services/client'

/** Sign administrators in with visible request and credential errors. */
export function LoginPage() {
  const { login, notice } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async () => {
    setBusy(true)
    setError('')
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
            Workplace administration
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
            Manage your facilities, coordinate engineers, and keep workplace incidents moving.
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
            Sign in to your admin workspace.
          </Typography>
          <Stack
            component="form"
            spacing={2.5}
            onSubmit={(event) => {
              event.preventDefault()
              void submit()
            }}
          >
            {(error || notice) && <Alert severity="error">{error || notice}</Alert>}
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
          <Typography variant="caption" color="text.secondary" sx={{ mt: 3, display: 'block' }}>
            Facility Admin access is required.
          </Typography>
        </Paper>
      </Stack>
    </Box>
  )
}

LoginPage.propTypes = {}
