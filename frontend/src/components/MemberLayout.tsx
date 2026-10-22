import {
  Avatar,
  Box,
  Button,
  IconButton,
  Tab,
  Tabs,
  Toolbar,
  Tooltip,
  Typography,
} from '@mui/material'
import ApartmentOutlined from '@mui/icons-material/ApartmentOutlined'
import LogoutOutlined from '@mui/icons-material/LogoutOutlined'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/context'
import { RecordDialogProvider } from '../dialogs/RecordDialogProvider'

/** Share responsive account controls and navigation for employees and engineers. */
export function MemberLayout() {
  const { user, logout } = useAuth()
  const location = useLocation()
  const engineer = Boolean(user?.engineer_profile)
  return (
    <Box sx={{ minHeight: '100dvh', minWidth: 0 }}>
      <Toolbar
        sx={{ bgcolor: '#12253b', color: 'white', gap: { xs: 1, sm: 2 }, flexWrap: 'wrap', py: 1 }}
      >
        <ApartmentOutlined sx={{ color: '#80a9ff', display: { xs: 'none', sm: 'block' } }} />
        <Box sx={{ mr: 'auto', minWidth: 0 }}>
          <Typography
            noWrap
            sx={{
              fontWeight: 800,
              fontSize: { xs: 12, sm: 16 },
              letterSpacing: { xs: 0.5, sm: 1 },
            }}
          >
            ACME FACILITIES
          </Typography>
          <Typography
            noWrap
            variant="caption"
            sx={{ fontSize: { xs: 11, sm: 12 }, color: '#a6b9cd' }}
          >
            {engineer ? 'Engineer workspace' : 'Employee workspace'}
          </Typography>
        </Box>
        {!engineer && (
          <Button
            component={Link}
            to="/employee/incidents"
            color="inherit"
            sx={{ fontSize: { xs: 12, sm: 13 }, px: { xs: 1, sm: 2 }, flexShrink: 0 }}
          >
            My incidents
          </Button>
        )}
        <Avatar
          sx={{
            display: { xs: 'none', sm: 'flex' },
            width: 30,
            height: 30,
            bgcolor: '#25446a',
            fontSize: 12,
          }}
        >
          {user?.name.slice(0, 2).toUpperCase()}
        </Avatar>
        <Typography
          variant="body2"
          noWrap
          sx={{ display: { xs: 'none', sm: 'block' }, maxWidth: 180 }}
        >
          {user?.name}
        </Typography>
        <Tooltip title="Sign out">
          <IconButton
            color="inherit"
            aria-label="Sign out"
            onClick={() => void logout()}
            sx={{ display: { xs: 'inline-flex', sm: 'none' } }}
          >
            <LogoutOutlined />
          </IconButton>
        </Tooltip>
        <Button
          sx={{ display: { xs: 'none', sm: 'inline-flex' } }}
          color="inherit"
          startIcon={<LogoutOutlined />}
          onClick={() => void logout()}
        >
          Sign out
        </Button>
      </Toolbar>
      {engineer && (
        <Tabs
          component="nav"
          aria-label="Engineer workspace"
          value={location.pathname.startsWith('/engineer/') ? 'assigned' : 'reported'}
          variant="scrollable"
          scrollButtons="auto"
          sx={{
            bgcolor: 'background.paper',
            borderBottom: '1px solid',
            borderColor: 'divider',
            px: { xs: 1, sm: 3 },
          }}
        >
          <Tab component={Link} to="/engineer/incidents" value="assigned" label="Assigned to me" />
          <Tab component={Link} to="/employee/incidents" value="reported" label="My incidents" />
        </Tabs>
      )}
      <Box
        component="main"
        sx={{ p: { xs: 2, sm: 3, lg: 4 }, maxWidth: 1500, mx: 'auto', minWidth: 0 }}
      >
        <RecordDialogProvider>
          <Outlet />
        </RecordDialogProvider>
      </Box>
    </Box>
  )
}
