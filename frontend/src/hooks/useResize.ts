/**
 * useResize.ts
 * Generic drag-to-resize hook for panel layouts.
 *
 * Usage:
 *   const { size, handleMouseDown } = useResize({
 *     defaultSize: 260,
 *     min: 160,
 *     max: 480,
 *     direction: 'horizontal',   // 'horizontal' | 'vertical'
 *     storageKey: 'sidebar-w',   // optional: persists across sessions
 *   })
 */

import { useCallback, useEffect, useRef, useState } from 'react'

interface UseResizeOptions {
  defaultSize: number
  min: number
  max: number
  direction: 'horizontal' | 'vertical'
  storageKey?: string
  /** Called every frame while dragging — useful for notifying Monaco to relayout */
  onResize?: (size: number) => void
  /** When true, panel grows opposite to drag direction (e.g. terminal grows up, chat grows left) */
  invert?: boolean
}

export function useResize({
  defaultSize,
  min,
  max,
  direction,
  storageKey,
  onResize,
  invert = false,
}: UseResizeOptions) {
  const stored = storageKey ? Number(localStorage.getItem(storageKey)) || defaultSize : defaultSize
  const [size, setSize] = useState(Math.max(min, Math.min(max, stored)))
  const dragging = useRef(false)
  const startPos = useRef(0)
  const startSize = useRef(0)

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      dragging.current = true
      startPos.current  = direction === 'horizontal' ? e.clientX : e.clientY
      startSize.current = size

      document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize'
      document.body.style.userSelect = 'none'
    },
    [size, direction]
  )

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return
      const rawDelta =
        (direction === 'horizontal' ? e.clientX : e.clientY) - startPos.current
      const delta = invert ? -rawDelta : rawDelta
      const next = Math.max(min, Math.min(max, startSize.current + delta))
      setSize(next)
      onResize?.(next)
    }

    const onUp = () => {
      if (!dragging.current) return
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      // Persist
      if (storageKey) {
        localStorage.setItem(storageKey, String(size))
      }
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [direction, min, max, storageKey, size, onResize, invert])

  // Persist on size change (debounced via the mouseup handler above, but
  // also write here so refreshes after programmatic changes are saved)
  useEffect(() => {
    if (storageKey) localStorage.setItem(storageKey, String(size))
  }, [size, storageKey])

  return { size, setSize, handleMouseDown }
}
