import { useState } from 'react'
import {
  Avatar,
  Box,
  Breadcrumbs,
  Chip,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Snackbar,
  Alert,
  Stack,
  Toolbar,
  Tooltip,
  Typography,
} from '@mui/material'
import ApartmentOutlined from '@mui/icons-material/ApartmentOutlined'
import AssignmentOutlined from '@mui/icons-material/AssignmentOutlined'
import ChairOutlined from '@mui/icons-material/ChairOutlined'
import EngineeringOutlined from '@mui/icons-material/EngineeringOutlined'
import GroupOutlined from '@mui/icons-material/GroupOutlined'
import LayersOutlined from '@mui/icons-material/LayersOutlined'
import LogoutOutlined from '@mui/icons-material/LogoutOutlined'
import MenuOutlined from '@mui/icons-material/MenuOutlined'
import NotesOutlined from '@mui/icons-material/NotesOutlined'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/context'
import { useQueryClient } from '@tanstack/react-query'
import { invalidateResourceQueries } from '../services/queries'
import type { ResourceKey } from '../types'
import { resources } from '../resources/definitions'

export interface AdminOutlet {
  changed: (message: string, resource?: ResourceKey) => void
}
const width = 248
const icons = {
  incidents: <AssignmentOutlined />,
  users: <GroupOutlined />,
  engineers: <EngineeringOutlined />,
  buildings: <ApartmentOutlined />,
  floors: <LayersOutlined />,
  seats: <ChairOutlined />,
  notes: <NotesOutlined />,
}

/** Provide persistent admin navigation, account controls and mutation notifications. */
export function AdminLayout() {
  const { user, logout } = useAuth()
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const queryClient = useQueryClient()
  const [message, setMessage] = useState('')
  const current = resources.find((resource) => location.pathname.endsWith(`/${resource.key}`))
  const changed = (notice: string, resource?: ResourceKey) => {
    const target = resource ?? current?.key
    if (target)
      void invalidateResourceQueries(
        queryClient,
        target,
        resource
          ? []
          : [
              ...(current?.lookups || []),
              ...(current?.key === 'notes' ? ['incidents' as const] : []),
            ],
      )
    setMessage(notice)
  }
  const navigation = (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        color: '#d9e3ef',
        bgcolor: '#12253b',
      }}
    >
      <Stack direction="row" spacing={1.5} sx={{ px: 3, py: 3.5, alignItems: 'center' }}>
        <Box sx={{ bgcolor: '#2c6bed', p: 1, borderRadius: 2, display: 'flex' }}>
          <ApartmentOutlined sx={{ color: 'white' }} />
        </Box>
        <Box>
          <Typography sx={{ fontWeight: 800, letterSpacing: 2 }} color="white">
            ACME
          </Typography>
          <Typography sx={{ fontSize: 11, letterSpacing: 1.3 }} color="#94abc2">
            FACILITIES
          </Typography>
        </Box>
      </Stack>
      <Divider sx={{ borderColor: '#ffffff12', mx: 2 }} />
      <Typography
        variant="overline"
        sx={{ px: 3, pt: 3, pb: 1, color: '#7e98b2', fontSize: 10, letterSpacing: 1.6 }}
      >
        Administration
      </Typography>
      <List component="nav" aria-label="Administration" sx={{ px: 1.5 }}>
        {resources.map((resource) => (
          <ListItemButton
            key={resource.key}
            component={NavLink}
            to={`/admin/${resource.key}`}
            onClick={() => setMobileOpen(false)}
            sx={{
              mb: 0.5,
              px: 1.5,
              py: 1,
              borderRadius: 1.5,
              '&.active': { bgcolor: '#25446a', color: '#fff' },
              '&:hover': { bgcolor: '#ffffff0c' },
            }}
          >
            <ListItemIcon sx={{ minWidth: 38, color: 'inherit' }}>
              {icons[resource.key]}
            </ListItemIcon>
            <ListItemText
              primary={resource.title}
              slotProps={{ primary: { sx: { fontSize: 13, fontWeight: 600 } } }}
            />
          </ListItemButton>
        ))}
      </List>
      <Box sx={{ mt: 'auto', p: 2.5 }}>
        <Divider sx={{ borderColor: '#ffffff12', mb: 2 }} />
        <Chip
          label="Admin workspace"
          size="small"
          sx={{ bgcolor: '#ffffff10', color: '#a9bfd5', fontSize: 11 }}
        />
        <Typography variant="caption" sx={{ color: '#7e98b2', mt: 1, display: 'block' }}>
          Workplace operations, in one place.
        </Typography>
      </Box>
    </Box>
  )
  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <Box component="aside" sx={{ width: { md: width }, flexShrink: { md: 0 } }}>
        <Drawer
          variant="permanent"
          sx={{ display: { xs: 'none', md: 'block' }, '& .MuiDrawer-paper': { width, border: 0 } }}
        >
          {navigation}
        </Drawer>
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          sx={{ display: { md: 'none' }, '& .MuiDrawer-paper': { width } }}
        >
          {navigation}
        </Drawer>
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Toolbar
          sx={{
            minHeight: '76px !important',
            bgcolor: 'background.paper',
            borderBottom: '1px solid',
            borderColor: 'divider',
            gap: 2,
          }}
        >
          <IconButton
            aria-label="Open navigation"
            onClick={() => setMobileOpen(true)}
            sx={{ display: { md: 'none' } }}
          >
            <MenuOutlined />
          </IconButton>
          <Breadcrumbs
            sx={{
              flex: 1,
              '& .MuiBreadcrumbs-separator:first-of-type': { display: { xs: 'none', sm: 'flex' } },
            }}
          >
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ display: { xs: 'none', sm: 'block' } }}
            >
              Administration
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {current?.title}
            </Typography>
          </Breadcrumbs>
          <Avatar
            sx={{ width: 32, height: 32, bgcolor: '#e9effc', color: 'primary.main', fontSize: 13 }}
          >
            {user?.name.slice(0, 2).toUpperCase()}
          </Avatar>
          <Box sx={{ display: { xs: 'none', sm: 'block' } }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {user?.name}
            </Typography>
            <Typography sx={{ fontSize: 11 }} color="text.secondary">
              Facility Admin
            </Typography>
          </Box>
          <Tooltip title="Sign out">
            <IconButton aria-label="Sign out" onClick={() => void logout()}>
              <LogoutOutlined fontSize="small" />
            </IconButton>
          </Tooltip>
        </Toolbar>
        <Box component="main" sx={{ p: { xs: 2, sm: 3, lg: 4 }, maxWidth: 1700, mx: 'auto' }}>
          <Outlet context={{ changed } satisfies AdminOutlet} />
        </Box>
      </Box>
      <Snackbar open={Boolean(message)} autoHideDuration={4000} onClose={() => setMessage('')}>
        <Alert severity="success" variant="filled" onClose={() => setMessage('')}>
          {message}
        </Alert>
      </Snackbar>
    </Box>
  )
}

AdminLayout.propTypes = {}
