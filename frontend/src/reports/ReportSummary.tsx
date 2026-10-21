import { Box, Paper, Typography } from '@mui/material'
import { duration, type Report } from './query'

/** Explain each aggregate alongside its sample size or business meaning. */
export function ReportSummary({ report }: { report: Report }) {
  const metrics =
    report.report === 'timings'
      ? report.milestones.map((metric) => ({
          label: metric.label,
          value: duration(metric.average_minutes),
          detail: `${metric.sample_count} recorded of ${report.row_count} matching incidents`,
        }))
      : report.report === 'workload'
        ? [
            {
              label: 'Engineers',
              value: report.rows.length,
              detail: 'Includes engineers with no assignments',
            },
            {
              label: 'Available',
              value: report.rows.filter((row) => row.is_available).length,
              detail: 'Availability is set on the engineer profile',
            },
            {
              label: 'Active assignments',
              value: report.rows.reduce((sum, row) => sum + row.active_count, 0),
              detail: 'Open, In Progress and Blocked',
            },
            {
              label: 'Unassigned active incidents',
              value: report.unassigned_count,
              detail: 'Awaiting an engineer assignment',
            },
          ]
        : report.report === 'categories'
          ? [
              {
                label: 'Total incidents',
                value: report.rows.reduce((sum, row) => sum + row.incident_count, 0),
                detail: 'All statuses in the selected scope',
              },
              {
                label: 'Active incidents',
                value: report.rows.reduce((sum, row) => sum + row.active_count, 0),
                detail: 'Open, In Progress and Blocked',
              },
            ]
          : [
              {
                label: 'Recurring location/category groups',
                value: report.rows.length,
                detail: 'At least two incidents per group, across all statuses',
              },
            ]
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: {
          xs: '1fr',
          sm: 'repeat(2, minmax(0, 1fr))',
          lg: `repeat(${metrics.length}, minmax(0, 1fr))`,
        },
        gap: 2,
      }}
    >
      {metrics.map((metric) => (
        <Paper key={metric.label} variant="outlined" sx={{ p: 2.5, minWidth: 0 }}>
          <Typography variant="body2" color="text.secondary">
            {metric.label}
          </Typography>
          <Typography variant="h5" sx={{ my: 1, fontWeight: 700 }}>
            {metric.value}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {metric.detail}
          </Typography>
        </Paper>
      ))}
    </Box>
  )
}
