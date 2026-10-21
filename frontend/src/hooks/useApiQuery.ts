import { useEffect, useState } from 'react'
import { api, errorMessage } from '../services/client'

/** Load JSON with cancellation and preserve the previous page while a new one loads. */
export function useApiQuery<T>(path: string | null, initialData: T, revision = 0) {
  const key = `${path}:${revision}`
  const [result, setResult] = useState({ key: '', data: initialData, error: '' })
  useEffect(() => {
    if (!path) return undefined
    const controller = new AbortController()
    api<T>(path, { signal: controller.signal }).then(
      (data) => {
        if (!controller.signal.aborted) setResult({ key, data, error: '' })
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setResult((previous) => ({ ...previous, key, error: errorMessage(error) }))
      },
    )
    return () => controller.abort()
  }, [key, path])
  return {
    data: result.data,
    error: result.key === key ? result.error : '',
    loading: Boolean(path && result.key !== key),
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
