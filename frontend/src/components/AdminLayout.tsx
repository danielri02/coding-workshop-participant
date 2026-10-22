import { useState } from 'react'
import {
  Avatar,
  Box,
  Breadcrumbs,
  Chip,
  Divider,
  Drawer,
  IconButton,
  Snackbar,
  Alert,
  Stack,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import ApartmentOutlined from '@mui/icons-material/ApartmentOutlined'
import ChevronLeftOutlined from '@mui/icons-material/ChevronLeftOutlined'
import LogoutOutlined from '@mui/icons-material/LogoutOutlined'
import MenuOutlined from '@mui/icons-material/MenuOutlined'
import { Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/context'
import { useQueryClient } from '@tanstack/react-query'
import { invalidateResourceQueries } from '../services/queries'
import type { ResourceKey } from '../types'
import { resources } from '../resources/definitions'
import { reports } from '../reports/definitions'
import { SidebarNavigation } from './SidebarNavigation'
import { RecordDialogProvider } from '../dialogs/RecordDialogProvider'

export interface AdminOutlet {
  changed: (message: string, resource?: ResourceKey) => void
}
const expandedWidth = 248
const collapsedWidth = 72

/** Provide persistent admin navigation, account controls and mutation notifications. */
export function AdminLayout() {
  const { user, logout } = useAuth()
  const location = useLocation()
  const theme = useTheme()
  const desktop = useMediaQuery(theme.breakpoints.up('md'))
  const wide = useMediaQuery(theme.breakpoints.up('lg'))
  const [expanded, setExpanded] = useState<boolean | null>(null)
  const sidebarExpanded = expanded ?? wide
  const sidebarWidth = sidebarExpanded ? expandedWidth : collapsedWidth
  const [mobileOpen, setMobileOpen] = useState(false)
  const navigationLabel = desktop
    ? sidebarExpanded
      ? 'Collapse navigation'
      : 'Expand navigation'
    : 'Open navigation'
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
  const navigation = (showLabels: boolean) => (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        color: '#d9e3ef',
        bgcolor: '#12253b',
      }}
    >
      <Stack
        direction="row"
        spacing={showLabels ? 1.5 : 0}
        sx={{
          flexShrink: 0,
          px: showLabels ? 3 : 0,
          py: 2.5,
          alignItems: 'center',
          justifyContent: showLabels ? 'flex-start' : 'center',
        }}
      >
        <Box sx={{ bgcolor: '#2c6bed', p: 1, borderRadius: 2, display: 'flex' }}>
          <ApartmentOutlined sx={{ color: 'white' }} />
        </Box>
        <Box sx={{ display: showLabels ? 'block' : 'none' }}>
          <Typography sx={{ fontWeight: 800, letterSpacing: 2 }} color="white">
            ACME
          </Typography>
          <Typography sx={{ fontSize: 11, letterSpacing: 1.3 }} color="#94abc2">
            FACILITIES
          </Typography>
        </Box>
      </Stack>
      <Divider sx={{ borderColor: '#ffffff12', mx: 2 }} />
      {showLabels && (
        <Typography
          variant="overline"
          sx={{
            flexShrink: 0,
            px: 3,
            pt: 2,
            pb: 1,
            color: '#7e98b2',
            fontSize: 10,
            letterSpacing: 1.6,
          }}
        >
          Administration
        </Typography>
      )}
      <SidebarNavigation
        showLabels={showLabels}
        onExpand={() => setExpanded(true)}
        onNavigate={() => setMobileOpen(false)}
      />
      <Box sx={{ flexShrink: 0, mt: 'auto', p: 2.5, display: showLabels ? 'block' : 'none' }}>
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
    <Box sx={{ display: 'flex', minHeight: '100dvh', width: '100%', minWidth: 0 }}>
      <Box component="aside" sx={{ width: { xs: 0, md: sidebarWidth }, flexShrink: 0 }}>
        <Drawer
          id="desktop-admin-navigation"
          variant="permanent"
          sx={{
            display: { xs: 'none', md: 'block' },
            '& .MuiDrawer-paper': { width: sidebarWidth, border: 0 },
          }}
        >
          {navigation(sidebarExpanded)}
        </Drawer>
        <Drawer
          id="mobile-admin-navigation"
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          sx={{ display: { md: 'none' }, '& .MuiDrawer-paper': { width: expandedWidth } }}
        >
          {navigation(true)}
        </Drawer>
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Toolbar
          sx={{
            minHeight: '76px !important',
            bgcolor: 'background.paper',
            borderBottom: '1px solid',
            borderColor: 'divider',
            gap: { xs: 1, sm: 2 },
            px: { xs: 1.5, sm: 2 },
          }}
        >
          <Tooltip title={navigationLabel}>
            <IconButton
              aria-label={navigationLabel}
              aria-expanded={desktop ? sidebarExpanded : mobileOpen}
              aria-controls={desktop ? 'desktop-admin-navigation' : 'mobile-admin-navigation'}
              onClick={() => (desktop ? setExpanded(!sidebarExpanded) : setMobileOpen(true))}
              sx={{ flexShrink: 0 }}
            >
              {desktop && sidebarExpanded ? <ChevronLeftOutlined /> : <MenuOutlined />}
            </IconButton>
          </Tooltip>
          <Breadcrumbs
            sx={{
              flex: 1,
              minWidth: 0,
              '& .MuiBreadcrumbs-separator': { display: { xs: 'none', sm: 'flex' } },
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
              {reports.find((report) => location.pathname === `/admin/reports/${report.key}`)
                ?.title ?? current?.title}
            </Typography>
          </Breadcrumbs>
          <Avatar
            sx={{
              width: 32,
              height: 32,
              flexShrink: 0,
              bgcolor: '#e9effc',
              color: 'primary.main',
              fontSize: 13,
            }}
          >
            {user?.name.slice(0, 2).toUpperCase()}
          </Avatar>
          <Box sx={{ display: { xs: 'none', sm: 'block' }, minWidth: 0, maxWidth: 180 }}>
            <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
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
        <Box
          component="main"
          sx={{
            p: { xs: 2, sm: 3, lg: 4 },
            minWidth: 0,
            width: '100%',
            maxWidth: 1700,
            mx: 'auto',
          }}
        >
          <RecordDialogProvider>
            <Outlet context={{ changed } satisfies AdminOutlet} />
          </RecordDialogProvider>
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
