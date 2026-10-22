import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { DialogContext, type DialogNavigation } from './context'
import { dialogEntry, targetKey, type DialogEntry, type DialogTarget } from './navigation'
import { RecordDialogHost } from './RecordDialogHost'
import { capturePageScroll } from './scroll'

/** Keep the page mounted while one dialog browses a reversible history of records. */
export function RecordDialogProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<DialogEntry[]>([])
  const [busy, setBusy] = useState(false)
  const restoreScroll = useRef<ReturnType<typeof capturePageScroll> | null>(null)
  const open = useCallback((target: DialogTarget) => {
    restoreScroll.current ??= capturePageScroll()
    setEntries((previous) =>
      previous.length && targetKey(previous[previous.length - 1].target) === targetKey(target)
        ? previous
        : [...previous, dialogEntry(target)],
    )
  }, [])
  const close = useCallback(() => {
    const restore = restoreScroll.current
    restoreScroll.current = null
    setEntries([])
    // Run after the modal's focus restoration, which can itself scroll a cell.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (!restoreScroll.current) restore?.()
      }),
    )
  }, [])
  const back = useCallback(() => setEntries((previous) => previous.slice(0, -1)), [])
  const setState = useCallback(
    (state: Partial<DialogEntry['state']>) =>
      setEntries((previous) =>
        previous.map((entry, index) =>
          index === previous.length - 1 ? { ...entry, state: { ...entry.state, ...state } } : entry,
        ),
      ),
    [],
  )
  const openRecord = useCallback<DialogNavigation['openRecord']>(
    (resource, id, options) => open({ kind: 'record', resource, id, ...options }),
    [open],
  )
  const openCollection = useCallback<DialogNavigation['openCollection']>(
    (resource, filters, title) => open({ kind: 'collection', resource, filters, title }),
    [open],
  )
  const navigation = useMemo(
    () => ({ entries, busy, setBusy, close, back, setState, open, openRecord, openCollection }),
    [entries, busy, close, back, setState, open, openRecord, openCollection],
  )
  return (
    <DialogContext.Provider value={navigation}>
      {children}
      {entries.length > 0 && <RecordDialogHost />}
    </DialogContext.Provider>
  )
}
