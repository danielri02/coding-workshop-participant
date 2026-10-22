interface ScrollPosition {
  element: HTMLElement
  left: number
  top: number
}

/** MUI grids synchronize virtual scrollers and scrollbar elements independently. */
export function capturePageScroll() {
  const positions: ScrollPosition[] = [
    ...document.querySelectorAll<HTMLElement>(
      '.MuiDataGrid-virtualScroller, .MuiDataGrid-scrollbar',
    ),
  ]
    .filter((element) => !element.closest('[role="dialog"]'))
    .map((element) => ({ element, left: element.scrollLeft, top: element.scrollTop }))
  const left = window.scrollX
  const top = window.scrollY
  return () => {
    for (const position of positions)
      if (position.element.isConnected)
        position.element.scrollTo({ left: position.left, top: position.top, behavior: 'instant' })
    window.scrollTo({ left, top, behavior: 'instant' })
  }
}
