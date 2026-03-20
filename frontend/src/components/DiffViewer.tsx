import React, { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

interface Props {
  diffText:     string
  filename:     string
  linesAdded:   number
  linesRemoved: number
  riskLevel:    'low' | 'medium' | 'high'
  onAccept:     () => void
  onReject:     () => void
  loading?:     boolean
}

export default function DiffViewer({ diffText, filename, linesAdded, linesRemoved, riskLevel, onAccept, onReject, loading }: Props) {
  const [collapsed, setCollapsed] = useState(false)

  const lines = diffText.split('\n')

  function lineClass(line: string) {
    if (line.startsWith('+++') || line.startsWith('---')) return 'diff-meta-line'
    if (line.startsWith('@@'))  return 'diff-meta-line'
    if (line.startsWith('+'))   return 'diff-add-line'
    if (line.startsWith('-'))   return 'diff-del-line'
    return 'diff-ctx-line'
  }

  return (
    <div style={{ border: '1px solid var(--border2)', borderRadius: 8, overflow: 'hidden', marginTop: 8 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--bg2)', borderBottom: '1px solid var(--border)' }}>
        <button onClick={() => setCollapsed(c => !c)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, display: 'flex' }}>
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </button>
        <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text)', flex: 1 }}>{filename}</code>
        <span className={`tag tag-${riskLevel === 'low' ? 'green' : riskLevel === 'medium' ? 'amber' : 'red'}`}>
          {riskLevel} risk
        </span>
        <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--green)' }}>+{linesAdded}</span>
        <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--red)' }}>-{linesRemoved}</span>
      </div>

      {/* Diff lines */}
      {!collapsed && (
        <div style={{ maxHeight: 340, overflow: 'auto', background: 'var(--bg)' }}>
          {lines.map((line, i) => (
            <div key={i} className={`diff-line ${lineClass(line)}`}>
              {line || ' '}
            </div>
          ))}
        </div>
      )}

      {/* Accept / Reject */}
      <div style={{ display: 'flex', gap: 8, padding: '8px 12px', background: 'var(--bg2)', borderTop: '1px solid var(--border)' }}>
        <button className="btn btn-success btn-sm" onClick={onAccept} disabled={loading}>
          {loading ? 'Applying...' : '✓ Accept'}
        </button>
        <button className="btn btn-danger btn-sm" onClick={onReject} disabled={loading}>
          ✕ Reject
        </button>
      </div>
    </div>
  )
}
