import { Box, Step, StepLabel, Stepper, Typography } from '@mui/material'
import type { IncidentStatus } from '../types'

const steps = ['Reported', 'In progress', 'Resolved', 'Closed']
const current: Record<IncidentStatus, number> = {
  Open: 0,
  'In Progress': 1,
  Blocked: 1,
  Resolved: 2,
  Closed: 4,
}

/** Show lifecycle progress; blocked work remains in the in-progress stage. */
export function IncidentProgress({ status }: { status: IncidentStatus }) {
  return (
    <Box sx={{ py: 2 }}>
      <Typography variant="subtitle2" sx={{ mb: 2 }}>
        Incident progress
      </Typography>
      <Stepper
        activeStep={current[status]}
        alternativeLabel
        sx={{
          '& .MuiStepLabel-label': { fontSize: { xs: 11, sm: 13 } },
          '& .MuiStep-root': { px: { xs: 0.5, sm: 1 } },
        }}
      >
        {steps.map((step, index) => (
          <Step key={step}>
            <StepLabel error={status === 'Blocked' && index === 1}>{step}</StepLabel>
          </Step>
        ))}
      </Stepper>
    </Box>
  )
}
