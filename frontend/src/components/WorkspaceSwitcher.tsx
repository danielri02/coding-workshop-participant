import { FormControl, InputLabel, MenuItem, Select } from '@mui/material'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/context'
import { availableWorkspaces } from '../auth/workspaces'
import { useWorkspace } from '../hooks/useWorkspace'

/** Admins retain their account while opening their employee or engineer workspace. */
export function WorkspaceSwitcher({ dark = false }: { dark?: boolean }) {
  const { user } = useAuth()
  const { workspace } = useWorkspace()
  const navigate = useNavigate()
  if (!user?.is_admin || !workspace) return null
  const choices = availableWorkspaces(user)
  return (
    <FormControl
      size="small"
      sx={{
        minWidth: { xs: 145, sm: 175 },
        maxWidth: '100%',
        ...(dark && {
          '& .MuiInputLabel-root, & .MuiSelect-select, & .MuiSelect-icon': { color: 'white' },
          '& .MuiOutlinedInput-notchedOutline': { borderColor: '#a6b9cd' },
        }),
      }}
    >
      <InputLabel id="workspace-label">Workspace</InputLabel>
      <Select
        labelId="workspace-label"
        label="Workspace"
        value={workspace.id}
        onChange={(event) => {
          const selected = choices.find((choice) => choice.id === event.target.value)
          if (selected) navigate(selected.path)
        }}
      >
        {choices.map((choice) => (
          <MenuItem key={choice.id} value={choice.id}>
            {choice.label}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  )
}
