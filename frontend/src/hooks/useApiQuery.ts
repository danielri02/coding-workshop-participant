import { useEffect, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api, errorMessage } from '../services/client'

/** Deduplicate reads, cancel abandoned requests and preserve the previous grid page. */
export function useApiQuery<T>(path: string | null, initialData: T) {
  const [fallback] = useState(() => initialData)
  const query = useQuery({
    queryKey: ['api', path],
    queryFn: ({ signal }) => api<T>(path!, { signal }),
    enabled: Boolean(path),
    placeholderData: keepPreviousData,
  })
  return {
    data: path ? (query.data ?? fallback) : fallback,
    error: query.error ? errorMessage(query.error) : '',
    loading: Boolean(path && query.isFetching),
  }
}

/** Debounce search changes so typing does not issue a request for every keystroke. */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])
  return debounced
}
