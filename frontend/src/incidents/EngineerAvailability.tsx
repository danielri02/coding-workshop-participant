import { useState } from 'react'
import { Alert, FormControlLabel, Stack, Switch, Typography } from '@mui/material'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/context'
import { api, errorMessage } from '../services/client'
import { invalidateResourceQueries } from '../services/queries'
import type { EngineerProfile } from '../types'

/** Availability is an explicit preference, independent of assigned workload. */
export function EngineerAvailability() {
  const { user, refreshUser } = useAuth()
  const client = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!user?.engineer_profile) return null
  const change = async (available: boolean) => {
    setBusy(true)
    setError('')
    try {
      await api<EngineerProfile>(`/engineer-profiles/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_available: available }),
      })
      await refreshUser()
      await invalidateResourceQueries(client, 'engineers')
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Stack spacing={1}>
      <FormControlLabel
        control={
          <Switch
            checked={user.engineer_profile.is_available}
            disabled={busy}
            onChange={(_, available) => void change(available)}
          />
        }
        label="Available for assignment"
      />
      <Typography variant="body2" color="text.secondary">
        Changing availability does not change your existing assignments.
      </Typography>
      {error && <Alert severity="error">{error}</Alert>}
    </Stack>
  )
}
