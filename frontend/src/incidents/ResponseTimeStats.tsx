import { useQueryClient } from '@tanstack/react-query'
import { Alert, Box, Button, Stack, Typography } from '@mui/material'
import { SummaryStats } from '../components/SummaryStats'
import { useApiQuery } from '../hooks/useApiQuery'
import { duration } from '../reports/query'
import type { ApiSchemas, Incident } from '../types'

/** Share sampled historical timings without loading or revealing other incident rows. */
export function ResponseTimeStats({ incident }: { incident?: Pick<Incident, 'id' | 'category'> }) {
  const client = useQueryClient()
  const path = incident ? `/incidents/${incident.id}/response-times` : '/reports/my-response-times'
  const query = useApiQuery<ApiSchemas['ResponseTimeSummary'] | null>(path, null)
  const title = incident
    ? 'Recent response times for similar incidents'
    : 'Your average response times'
  const metrics = (query.data?.milestones || []).filter(
    (metric) => incident || metric.id !== 'assigned',
  )
  return (
    <Box component="section" aria-label={title} aria-busy={query.loading}>
      <Stack spacing={1.5}>
        <Typography component="h2" variant="h6">
          {title}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {incident
            ? `${incident.category} incidents in this building, reported in the last 30 days.`
            : 'Incidents currently assigned to you, reported in the last 30 days. Independent of grid filters.'}{' '}
          Times run from reporting to each milestone.
        </Typography>
        {query.error ? (
          <Alert
            severity="warning"
            action={
              <Button onClick={() => void client.invalidateQueries({ queryKey: ['api', path] })}>
                Retry
              </Button>
            }
          >
            Response times unavailable: {query.error}
          </Alert>
        ) : !query.data ? (
          <Typography role="status" variant="body2">
            Loading response times…
          </Typography>
        ) : (
          <>
            {query.data.total_count === 0 && (
              <Typography variant="body2">
                No matching incidents were reported in the last 30 days.
              </Typography>
            )}
            <SummaryStats
              compact
              metrics={metrics.map((metric) => ({
                label: `Avg. ${metric.id === 'assigned' ? 'assignment' : metric.id === 'acknowledged' ? 'acknowledgment' : 'resolution'}`,
                value: metric.sample_count ? duration(metric.average_minutes) : '—',
                detail: `${metric.sample_count} of ${query.data!.total_count} incidents reached this milestone`,
              }))}
            />
            <Typography variant="caption" color="text.secondary">
              {incident
                ? 'Historical averages set expectations; they are not a guaranteed completion time. '
                : ''}
              Incidents that have not reached a milestone are excluded from its average.
            </Typography>
          </>
        )}
      </Stack>
    </Box>
  )
}
