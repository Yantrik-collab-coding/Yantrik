/**
 * ResizeHandle.tsx
 * A drag handle placed between resizable panels.
 *
 * Props:
 *   direction  — 'horizontal' (|) between side-by-side panels
 *              — 'vertical'   (—) between stacked panels
 *   onMouseDown — from useResize().handleMouseDown
 */

import React, { useState } from 'react'

interface ResizeHandleProps {
  direction: 'horizontal' | 'vertical'
  onMouseDown: (e: React.MouseEvent) => void
}

export default function ResizeHandle({ direction, onMouseDown }: ResizeHandleProps) {
  const [hovered, setHovered] = useState(false)

  const isH = direction === 'horizontal'

  const containerStyle: React.CSSProperties = {
    flexShrink: 0,
    position: 'relative',
    zIndex: 10,
    // Horizontal handle: thin vertical bar between columns
    // Vertical handle: thin horizontal bar between rows
    width:  isH ? 5 : '100%',
    height: isH ? '100%' : 5,
    cursor: isH ? 'col-resize' : 'row-resize',
    background: 'transparent',
    transition: 'background 0.15s',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  }

  // The visible line
  const lineStyle: React.CSSProperties = {
    position: 'absolute',
    background: hovered ? 'var(--teal)' : 'var(--border)',
    transition: 'background 0.15s, opacity 0.15s',
    borderRadius: 2,
    ...(isH
      ? { width: 1, height: '100%', top: 0, left: '50%', transform: 'translateX(-50%)' }
      : { height: 1, width: '100%', left: 0, top: '50%', transform: 'translateY(-50%)' }),
  }

  // The center grip dots
  const gripStyle: React.CSSProperties = {
    position: 'absolute',
    display: 'flex',
    flexDirection: isH ? 'column' : 'row',
    gap: 3,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: hovered ? 1 : 0,
    transition: 'opacity 0.15s',
    zIndex: 1,
  }

  const dotStyle: React.CSSProperties = {
    width: 3,
    height: 3,
    borderRadius: '50%',
    background: 'var(--teal)',
  }

  return (
    <div
      style={containerStyle}
      onMouseDown={onMouseDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={lineStyle} />
      <div style={gripStyle}>
        <div style={dotStyle} />
        <div style={dotStyle} />
        <div style={dotStyle} />
      </div>
    </div>
  )
}
