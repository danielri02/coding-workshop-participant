import { Alert, Box, Button, Stack, Typography } from '@mui/material'
import { SummaryStats } from '../components/SummaryStats'
import { useApiQuery } from '../hooks/useApiQuery'
import type { ApiSchemas } from '../types'
import type { IncidentScope } from './scope'

/** Summarize the full current-user scope rather than the grid's loaded page. */
export function IncidentSummary({
  scope,
  onRefresh,
}: {
  scope: IncidentScope
  onRefresh: () => void
}) {
  const assigned = scope === 'assigned'
  const query = useApiQuery<ApiSchemas['IncidentSummary'] | null>(
    `/reports/summary?scope=${assigned ? 'assigned' : 'personal'}`,
    null,
  )
  const metrics = assigned
    ? ([
        {
          field: 'in_progress_count',
          label: 'In progress',
          detail: 'Assignments currently underway',
        },
        { field: 'blocked_count', label: 'Blocked', detail: 'Assignments waiting on a blocker' },
        {
          field: 'resolved_count',
          label: 'Resolved',
          detail: 'Assignments awaiting admin closure',
        },
      ] as const)
    : ([
        {
          field: 'active_count',
          label: 'Active',
          detail: 'Your Open, In Progress and Blocked reports',
        },
        {
          field: 'resolved_count',
          label: 'Resolved',
          detail: 'Your reports awaiting admin closure',
        },
        { field: 'closed_count', label: 'Closed', detail: 'Your reports closed by an admin' },
      ] as const)
  return (
    <Box
      component="section"
      aria-label={assigned ? 'Assigned incident summary' : 'My incident summary'}
      aria-busy={query.loading}
    >
      <Stack spacing={1.5}>
        <Typography variant="body2" color="text.secondary">
          {assigned ? 'All incidents currently assigned to you' : 'All incidents you submitted'} ·
          independent of grid filters
        </Typography>
        {query.error ? (
          <Alert severity="warning" action={<Button onClick={onRefresh}>Retry</Button>}>
            Summary unavailable: {query.error}
          </Alert>
        ) : (
          <SummaryStats
            compact
            metrics={metrics.map(({ field, ...metric }) => ({
              ...metric,
              value: query.data?.[field] ?? '…',
            }))}
          />
        )}
      </Stack>
    </Box>
  )
}
