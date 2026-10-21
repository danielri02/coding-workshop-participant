import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material'
import PropTypes from 'prop-types'
import { Link as RouterLink } from 'react-router-dom'
import { RecordLink } from './RecordLink'
import { incidentCommands, type IncidentCommand } from '../resources/incidentActions'
import { useApiQuery } from '../hooks/useApiQuery'
import { decorateRow, floorLabel, recordLabel } from '../resources/rows'
import type { ResourceDefinition } from '../resources/definitions'
import type { AdminRow, ApiRecord, Lookups } from '../types'

interface DetailsProps {
  resource: ResourceDefinition
  row: AdminRow
  lookups: Lookups
  onClose: () => void
  onIncidentAction?: (command: IncidentCommand, row: AdminRow) => void
}

/** Show a fresh record, including descriptions, relationships and lifecycle timestamps. */
export function RecordDetailsDialog({
  resource,
  row,
  lookups,
  onClose,
  onIncidentAction,
}: DetailsProps) {
  const query = useApiQuery<ApiRecord | AdminRow>(`${resource.endpoint}/${row.id}`, row)
  const record = decorateRow(resource.key, query.data, lookups)
  const display = (field: string, value: unknown): string => {
    if (value === null || value === undefined || value === '') return '—'
    if (field === 'assignee_id') return record.assignee_name || recordLabel(lookups.users, value)
    if (field === 'building_id') return recordLabel(lookups.buildings, value)
    if (field === 'floor_id') return floorLabel(lookups, value)
    if (field === 'seat_id') return recordLabel(lookups.seats, value, 'label')
    if (field === 'reporter_id' || field === 'user_id') return recordLabel(lookups.users, value)
    if (field.endsWith('_at')) return new Date(String(value)).toLocaleString()
    if (typeof value === 'boolean') return value ? 'Yes' : 'No'
    return String(value)
  }
  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth aria-labelledby="record-details-title">
      <DialogTitle id="record-details-title">
        {resource.singular[0].toUpperCase() + resource.singular.slice(1)} #{row.id}
      </DialogTitle>
      <DialogContent>
        {resource.key === 'incidents' && (
          <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 1, mb: 3 }}>
            <Button
              component={RouterLink}
              to={`/admin/notes?incident=${row.id}`}
              variant="outlined"
            >
              View notes
            </Button>
            {onIncidentAction &&
              incidentCommands(record).map((command) => (
                <Button
                  key={command.action}
                  variant="outlined"
                  disabled={query.loading || Boolean(query.error)}
                  onClick={() => onIncidentAction(command.action, record)}
                >
                  {command.label}
                </Button>
              ))}
          </Stack>
        )}
        {query.error ? (
          <Alert severity="error">{query.error}</Alert>
        ) : query.loading ? (
          <CircularProgress aria-label="Loading record" />
        ) : (
          <Box
            component="dl"
            sx={{
              m: 0,
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: '170px 1fr' },
              gap: 2,
            }}
          >
            {Object.entries(record)
              .filter(([, value]) => typeof value !== 'object' || value === null)
              .map(([field, value]) => (
                <Box key={field} sx={{ display: 'contents' }}>
                  <Typography
                    component="dt"
                    variant="body2"
                    color="text.secondary"
                    sx={{ textTransform: 'capitalize' }}
                  >
                    {field.replaceAll('_', ' ')}
                  </Typography>
                  <Typography
                    component="dd"
                    variant="body2"
                    sx={{ m: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                  >
                    {field === 'assignee_id' && record.assignee_id ? (
                      <RecordLink resource="engineers" id={record.assignee_id}>
                        {display(field, value)}
                      </RecordLink>
                    ) : (
                      display(field, value)
                    )}
                  </Typography>
                </Box>
              ))}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}

RecordDetailsDialog.propTypes = {
  resource: PropTypes.object.isRequired,
  row: PropTypes.object.isRequired,
  lookups: PropTypes.object.isRequired,
  onClose: PropTypes.func.isRequired,
  onIncidentAction: PropTypes.func,
}
