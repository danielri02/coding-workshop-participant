import { useState } from 'react'
import { Alert, Autocomplete, CircularProgress, Stack, TextField, Typography } from '@mui/material'
import { useApiQuery, useDebouncedValue } from '../hooks/useApiQuery'
import type { Incident, IncidentPage } from '../types'

const label = (incident: Incident) => `#${incident.id} · ${incident.title} · ${incident.status}`

/** Search a bounded server result set instead of loading the entire incident directory. */
export function IncidentPicker({
  id,
  value,
  onChange,
}: {
  id: number | null
  value: Incident | null
  onChange: (incident: Incident | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const term = useDebouncedValue(input)
  const match = /^#?(\d+)$/.exec(term.trim())
  const exactId = match ? Number(match[1]) : 0
  const validId = Number.isSafeInteger(exactId) && exactId > 0 && exactId <= 2147483647
  const exact = useApiQuery<Incident | null>(open && validId ? `/incidents/${exactId}` : null, null)
  const query = useApiQuery<IncidentPage>(
    open
      ? `/incidents/grid?${new URLSearchParams({
          page: '0',
          page_size: '25',
          sort_by: 'created_at',
          sort_direction: 'desc',
          ...(term.trim() ? { search: term.trim() } : {}),
        })}`
      : null,
    { rows: [], row_count: 0, page: 0, page_size: 25 },
  )
  const choices = [
    ...(value?.id === id ? [value] : []),
    ...(exact.data?.id === exactId && !exact.error ? [exact.data] : []),
    ...query.data.rows,
  ].filter((row, index, all) => all.findIndex((other) => other.id === row.id) === index)
  const loading = query.loading || exact.loading || term !== input
  return (
    <Stack spacing={1}>
      <Autocomplete
        open={open}
        onOpen={() => setOpen(true)}
        onClose={() => setOpen(false)}
        value={value?.id === id ? value : null}
        options={choices}
        filterOptions={(options) => options}
        getOptionLabel={label}
        isOptionEqualToValue={(option, selected) => option.id === selected.id}
        loading={loading}
        noOptionsText="No matching incidents"
        onChange={(_, selected) => onChange(selected)}
        onInputChange={(_, text, reason) => {
          if (reason === 'input' || reason === 'clear') setInput(text)
          else if (reason === 'reset' || reason === 'selectOption') setInput('')
        }}
        renderInput={(params) => (
          <TextField
            {...params}
            label="Incident"
            placeholder="Search by ID, title or description"
            helperText="Type to search incidents. Up to 25 recent matches are shown; refine the search to find older reports."
            slotProps={{
              ...params.slotProps,
              htmlInput: { ...params.slotProps.htmlInput, maxLength: 200 },
              input: {
                ...params.slotProps.input,
                endAdornment: (
                  <>
                    {loading && <CircularProgress size={18} aria-label="Searching incidents" />}
                    {params.slotProps.input.endAdornment}
                  </>
                ),
              },
            }}
          />
        )}
      />
      {query.error && <Alert severity="error">Unable to search incidents: {query.error}</Alert>}
      {open && query.data.row_count > 25 && (
        <Typography variant="caption" color="text.secondary">
          {query.data.row_count} matches. Refine your search to narrow the results.
        </Typography>
      )}
    </Stack>
  )
}
