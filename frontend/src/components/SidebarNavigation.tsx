import { useId, useState } from 'react'
import { Collapse, List, ListItemButton, ListItemIcon, ListItemText, Tooltip } from '@mui/material'
import ApartmentOutlined from '@mui/icons-material/ApartmentOutlined'
import AssignmentOutlined from '@mui/icons-material/AssignmentOutlined'
import AssessmentOutlined from '@mui/icons-material/AssessmentOutlined'
import ChairOutlined from '@mui/icons-material/ChairOutlined'
import EngineeringOutlined from '@mui/icons-material/EngineeringOutlined'
import ExpandLess from '@mui/icons-material/ExpandLess'
import ExpandMore from '@mui/icons-material/ExpandMore'
import GroupOutlined from '@mui/icons-material/GroupOutlined'
import LayersOutlined from '@mui/icons-material/LayersOutlined'
import NotesOutlined from '@mui/icons-material/NotesOutlined'
import { NavLink, useLocation } from 'react-router-dom'
import { resources } from '../resources/definitions'
import { reports } from '../reports/definitions'

const icons = {
  incidents: <AssignmentOutlined />,
  users: <GroupOutlined />,
  engineers: <EngineeringOutlined />,
  buildings: <ApartmentOutlined />,
  floors: <LayersOutlined />,
  seats: <ChairOutlined />,
  notes: <NotesOutlined />,
}
const itemStyle = {
  mb: 0.5,
  px: 1.5,
  py: 1,
  borderRadius: 1.5,
  '&.active': { bgcolor: '#25446a', color: '#fff' },
  '&:hover': { bgcolor: '#ffffff0c' },
}

/** Keep all navigation, including the final Reports group, reachable in short windows. */
export function SidebarNavigation({
  showLabels,
  onExpand,
  onNavigate,
}: {
  showLabels: boolean
  onExpand: () => void
  onNavigate: () => void
}) {
  const location = useLocation()
  const activeReport = location.pathname.startsWith('/admin/reports/')
  const [open, setOpen] = useState(activeReport)
  const groupId = useId()
  return (
    <List
      component="nav"
      aria-label="Administration"
      sx={{
        flex: 1,
        px: 1.5,
        minHeight: 0,
        overflowY: 'auto',
        overscrollBehavior: 'contain',
        mt: showLabels ? 0 : 1,
      }}
    >
      {resources.map((resource) => (
        <Tooltip key={resource.key} title={showLabels ? '' : resource.title} placement="right">
          <ListItemButton
            component={NavLink}
            aria-label={resource.title}
            to={`/admin/${resource.key}`}
            onClick={onNavigate}
            sx={{ ...itemStyle, justifyContent: showLabels ? 'flex-start' : 'center' }}
          >
            <ListItemIcon sx={{ minWidth: showLabels ? 38 : 0, color: 'inherit' }}>
              {icons[resource.key]}
            </ListItemIcon>
            <ListItemText
              primary={resource.title}
              sx={{ display: showLabels ? 'block' : 'none' }}
              slotProps={{ primary: { sx: { fontSize: 13, fontWeight: 600 } } }}
            />
          </ListItemButton>
        </Tooltip>
      ))}
      <Tooltip title={showLabels ? '' : 'Reports'} placement="right">
        <ListItemButton
          aria-label="Reports"
          aria-expanded={showLabels && open}
          aria-controls={groupId}
          onClick={() => {
            if (!showLabels) onExpand()
            setOpen(!showLabels || !open)
          }}
          sx={{
            ...itemStyle,
            justifyContent: showLabels ? 'flex-start' : 'center',
            bgcolor: activeReport ? '#25446a' : undefined,
          }}
        >
          <ListItemIcon sx={{ minWidth: showLabels ? 38 : 0, color: 'inherit' }}>
            <AssessmentOutlined />
          </ListItemIcon>
          {showLabels && (
            <>
              <ListItemText
                primary="Reports"
                slotProps={{ primary: { sx: { fontSize: 13, fontWeight: 600 } } }}
              />
              {open ? <ExpandLess /> : <ExpandMore />}
            </>
          )}
        </ListItemButton>
      </Tooltip>
      <Collapse in={showLabels && open} unmountOnExit id={groupId}>
        <List component="div" disablePadding aria-label="Reports">
          {reports.map((report) => (
            <ListItemButton
              key={report.key}
              component={NavLink}
              to={`/admin/reports/${report.key}`}
              onClick={onNavigate}
              sx={{ ...itemStyle, pl: 3 }}
            >
              <ListItemText
                primary={report.title}
                slotProps={{ primary: { sx: { fontSize: 12 } } }}
              />
            </ListItemButton>
          ))}
        </List>
      </Collapse>
    </List>
  )
}
