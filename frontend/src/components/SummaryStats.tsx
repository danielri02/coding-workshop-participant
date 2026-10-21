import { Box, Paper, Typography } from '@mui/material'

export interface SummaryMetric {
  label: string
  value: string | number
  detail: string
}

/** Share responsive, accessible metric cards across workspaces and reports. */
export function SummaryStats({
  metrics,
  compact = false,
}: {
  metrics: readonly SummaryMetric[]
  compact?: boolean
}) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: {
          xs: compact ? `repeat(${metrics.length}, minmax(0, 1fr))` : '1fr',
          sm: compact ? `repeat(${metrics.length}, minmax(0, 1fr))` : 'repeat(2, minmax(0, 1fr))',
          lg: `repeat(${metrics.length}, minmax(0, 1fr))`,
        },
        gap: 2,
      }}
    >
      {metrics.map((metric) => (
        <Paper
          component="article"
          aria-label={metric.label}
          key={metric.label}
          variant="outlined"
          sx={{ p: compact ? { xs: 1.5, sm: 2.5 } : 2.5, minWidth: 0 }}
        >
          <Typography variant="body2" color="text.secondary">
            {metric.label}
          </Typography>
          <Typography variant="h5" sx={{ my: 1, fontWeight: 700 }}>
            {metric.value}
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: compact ? { xs: 'none', sm: 'block' } : 'block' }}
          >
            {metric.detail}
          </Typography>
        </Paper>
      ))}
    </Box>
  )
}
