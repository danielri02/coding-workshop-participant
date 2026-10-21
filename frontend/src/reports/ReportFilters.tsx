import { Alert, FormControlLabel, MenuItem, Stack, Switch, TextField } from '@mui/material'
import { useAuth } from '../auth/context'
import { categories } from '../generated/domain'
import { useLookups } from '../hooks/useLookups'
import type { ReportKey } from './definitions'
import { periods, type LocationLevel, type ReportFilters as Filters, type Scope } from './query'

interface Props {
  report: ReportKey
  scope: Scope
  level: LocationLevel
  filters: Filters
  onChange: (values: Record<string, string>) => void
}

/** Share period and scope controls while keeping each report's dimensions explicit. */
export function ReportFilters({ report, scope, level, filters, onChange }: Props) {
  const { user } = useAuth()
  const lookups = useLookups({
    lookups:
      report === 'categories'
        ? ['buildings', 'floors', 'seats']
        : report === 'timings' && user?.is_admin
          ? ['users']
          : [],
  })
  const select = (
    label: string,
    value: string,
    field: string,
    options: { value: string | number; label: string }[],
    all?: string,
    resets: Record<string, string> = {},
  ) => (
    <TextField
      select
      size="small"
      label={label}
      value={value}
      sx={{ minWidth: { xs: 0, sm: 190 }, flex: { xs: '1 1 100%', sm: '0 1 230px' } }}
      onChange={(event) => onChange({ [field]: event.target.value, ...resets })}
    >
      {all && <MenuItem value="">{all}</MenuItem>}
      {options.map((option) => (
        <MenuItem key={option.value} value={option.value}>
          {option.label}
        </MenuItem>
      ))}
    </TextField>
  )
  if (report === 'workload') return null
  return (
    <>
      {lookups.error && (
        <Alert severity="warning">Report filter options unavailable: {lookups.error}</Alert>
      )}
      <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 2 }}>
        {select('Period', filters.period, 'period', periods)}
        {select('Incident scope', scope, 'scope', [
          { value: 'visible', label: user?.is_admin ? 'All incidents' : 'All visible incidents' },
          { value: 'personal', label: 'My reported incidents' },
          ...(user?.engineer_profile
            ? [{ value: 'assigned', label: 'My assigned incidents' }]
            : []),
        ])}
        {report === 'locations' &&
          select('Group by location', level, 'level', [
            { value: 'building', label: 'Building' },
            { value: 'floor', label: 'Floor' },
            { value: 'seat', label: 'Seat' },
          ])}
        {(report === 'locations' || report === 'timings') &&
          select(
            'Category',
            filters.category || '',
            'category',
            categories.map((value) => ({ value, label: value })),
            'All categories',
          )}
        {report === 'timings' &&
          user?.is_admin &&
          select(
            'Current engineer',
            filters.assignee_id || '',
            'assignee_id',
            lookups.data.users
              .filter((account) => account.engineer_profile)
              .map((account) => ({ value: account.id, label: account.name })),
            'All engineers',
          )}
        {report === 'categories' && (
          <>
            {select(
              'Building',
              filters.building_id || '',
              'building_id',
              lookups.data.buildings.map((building) => ({
                value: building.id,
                label: building.name,
              })),
              'All locations',
              { floor_id: '', seat_id: '' },
            )}
            {filters.building_id &&
              select(
                'Floor',
                filters.floor_id || '',
                'floor_id',
                lookups.data.floors
                  .filter((floor) => String(floor.building_id) === filters.building_id)
                  .map((floor) => ({ value: floor.id, label: floor.label })),
                'All floors',
                { seat_id: '' },
              )}
            {filters.floor_id &&
              select(
                'Seat',
                filters.seat_id || '',
                'seat_id',
                lookups.data.seats
                  .filter((seat) => String(seat.floor_id) === filters.floor_id)
                  .map((seat) => ({ value: seat.id, label: seat.label })),
                'All seats',
              )}
          </>
        )}
        {report === 'locations' && (
          <FormControlLabel
            control={
              <Switch
                checked={filters.repeated_only === 'true'}
                onChange={(_, checked) => onChange({ repeated_only: checked ? 'true' : '' })}
              />
            }
            label="Repeated locations only (2+)"
          />
        )}
      </Stack>
    </>
  )
}
