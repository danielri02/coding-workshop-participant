import Chip from '@mui/material/Chip'
import PropTypes from 'prop-types'

/** Render consistent status, priority and availability indicators across grids. */
export function ValueChip({ value }: { value: string | boolean }) {
  const label = typeof value === 'boolean' ? (value ? 'Yes' : 'No') : value
  const colors: Record<string, 'default' | 'primary' | 'success' | 'warning' | 'error' | 'info'> = {
    Open: 'info',
    'In Progress': 'primary',
    Blocked: 'warning',
    Resolved: 'success',
    Closed: 'default',
    High: 'error',
    Medium: 'warning',
    Low: 'default',
    Yes: 'success',
    No: 'default',
    Available: 'success',
    Unavailable: 'default',
    Admin: 'primary',
    Employee: 'default',
  }
  return (
    <Chip
      label={label}
      color={colors[label] || 'default'}
      size="small"
      variant="outlined"
      sx={{ fontWeight: 600, borderRadius: 1.5 }}
    />
  )
}

ValueChip.propTypes = { value: PropTypes.oneOfType([PropTypes.string, PropTypes.bool]).isRequired }
