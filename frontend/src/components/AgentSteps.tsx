/**
 * AgentSteps.tsx  (updated)
 * Rendered inside ChatPanel's AgentBubble.
 * Visual refresh: cleaner step rows, better status icons, progress bar.
 */

import React, { useState } from 'react'
import { CheckCircle, XCircle, Clock, Loader, ChevronDown, ChevronRight, FileEdit, FilePlus, MessageSquare } from 'lucide-react'

export interface Step {
  step_number:    number
  action:         string
  target_file?:   string
  status:         'running' | 'done' | 'error' | 'pending_review' | 'pending'
  output?:        string
  diff_id?:       string
  lines_added?:   number
  lines_removed?: number
  risk_level?:    string
  error?:         string
}

interface Props {
  goal:          string
  steps:         Step[]
  username:      string
  avatarColor:   string
  onReviewDiff?: (diffId: string) => void
}

const ACTION_META: Record<string, { label: string; icon: React.ReactNode }> = {
  create_file:  { label: 'Create file',  icon: <FilePlus  size={11} /> },
  modify_file:  { label: 'Modify file',  icon: <FileEdit  size={11} /> },
  explain:      { label: 'Explain',      icon: <MessageSquare size={11} /> },
}

const RISK_COLORS: Record<string, string> = {
  low:      'rgba(52,211,153,0.15)',
  medium:   'rgba(251,191,36,0.15)',
  high:     'rgba(248,113,113,0.15)',
}
const RISK_TEXT: Record<string, string> = {
  low:    'var(--green)',
  medium: 'var(--amber)',
  high:   'var(--red)',
}

function StepIcon({ status }: { status: Step['status'] }) {
  const s: React.CSSProperties = { flexShrink: 0, marginTop: 1 }
  if (status === 'running')        return <Loader        size={13} style={{ ...s, color: 'var(--teal)',   animation: 'spin 1s linear infinite' }} />
  if (status === 'done')           return <CheckCircle   size={13} style={{ ...s, color: 'var(--green)' }} />
  if (status === 'pending_review') return <Clock         size={13} style={{ ...s, color: 'var(--amber)' }} />
  if (status === 'error')          return <XCircle       size={13} style={{ ...s, color: 'var(--red)'   }} />
  return                                  <Clock         size={13} style={{ ...s, color: 'var(--text-dim)' }} />
}

function statusLabel(status: Step['status']) {
  if (status === 'running')        return { text: 'running',        color: 'var(--teal)'    }
  if (status === 'done')           return { text: 'done',           color: 'var(--green)'   }
  if (status === 'pending_review') return { text: 'needs review',   color: 'var(--amber)'   }
  if (status === 'error')          return { text: 'failed',         color: 'var(--red)'     }
  return                                  { text: 'pending',        color: 'var(--text-dim)' }
}

export default function AgentSteps({ goal, steps, username, avatarColor, onReviewDiff }: Props) {
  const [collapsed, setCollapsed] = useState(false)

  const doneCount    = steps.filter(s => s.status === 'done').length
  const totalCount   = steps.length
  const hasRunning   = steps.some(s => s.status === 'running')
  const hasError     = steps.some(s => s.status === 'error')
  const allDone      = doneCount === totalCount && totalCount > 0
  const progressPct  = totalCount > 0 ? (doneCount / totalCount) * 100 : 0

  const overallColor = hasError ? 'var(--red)' : allDone ? 'var(--green)' : hasRunning ? 'var(--teal)' : 'var(--text-dim)'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

      {/* Goal + progress header */}
      <div style={{ marginBottom: 10 }}>
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 8,
          justifyContent: 'space-between'
        }}>
          <div style={{
            fontSize: 12, fontStyle: 'italic',
            color: 'var(--text-muted)', lineHeight: 1.5, flex: 1
          }}>
            "{goal}"
          </div>
          <button
            onClick={() => setCollapsed(p => !p)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-dim)', padding: 2, flexShrink: 0
            }}
          >
            {collapsed
              ? <ChevronRight size={13} />
              : <ChevronDown  size={13} />
            }
          </button>
        </div>

        {/* Progress bar */}
        <div style={{
          marginTop: 8,
          display: 'flex', alignItems: 'center', gap: 8
        }}>
          <div style={{
            flex: 1, height: 4, background: 'var(--bg3)',
            borderRadius: 2, overflow: 'hidden'
          }}>
            <div style={{
              height: '100%', borderRadius: 2,
              width: `${progressPct}%`,
              background: overallColor,
              transition: 'width 0.4s ease, background 0.3s',
            }} />
          </div>
          <span style={{
            fontSize: 10, fontFamily: 'var(--font-mono)',
            color: overallColor, fontWeight: 600, flexShrink: 0
          }}>
            {doneCount}/{totalCount}
          </span>
        </div>
      </div>

      {/* Steps list */}
      {!collapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {steps.map(s => {
            const meta   = ACTION_META[s.action] || { label: s.action, icon: null }
            const status = statusLabel(s.status)

            return (
              <div key={s.step_number} style={{
                display: 'flex', gap: 8,
                padding: '7px 10px',
                background: s.status === 'running'
                  ? 'rgba(45,212,191,0.04)'
                  : s.status === 'error'
                  ? 'rgba(248,113,113,0.04)'
                  : 'var(--bg1)',
                borderRadius: 8,
                border: `1px solid ${
                  s.status === 'running' ? 'rgba(45,212,191,0.15)'
                  : s.status === 'error' ? 'rgba(248,113,113,0.15)'
                  : 'var(--border)'
                }`,
                transition: 'all 0.2s',
              }}>

                {/* Step number + icon */}
                <div style={{
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', gap: 3, flexShrink: 0
                }}>
                  <span style={{
                    fontSize: 9, fontFamily: 'var(--font-mono)',
                    color: 'var(--text-dim)', fontWeight: 600
                  }}>{String(s.step_number).padStart(2, '0')}</span>
                  <StepIcon status={s.status} />
                </div>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    display: 'flex', alignItems: 'center',
                    gap: 6, flexWrap: 'wrap'
                  }}>
                    {/* Action chip */}
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
                    }}>
                      {meta.icon}{meta.label}
                    </span>

                    {/* Target file */}
                    {s.target_file && (
                      <code style={{
                        fontSize: 11, fontFamily: 'var(--font-mono)',
                        color: 'var(--teal)',
                        background: 'rgba(45,212,191,0.08)',
                        border: '1px solid rgba(45,212,191,0.15)',
                        padding: '1px 5px', borderRadius: 4,
                        maxWidth: '100%', overflow: 'hidden',
                        textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        display: 'inline-block'
                      }}>{s.target_file}</code>
                    )}

                    {/* Risk badge */}
                    {s.risk_level && (
                      <span style={{
                        fontSize: 10, fontWeight: 600,
                        background: RISK_COLORS[s.risk_level] || 'var(--bg3)',
                        color: RISK_TEXT[s.risk_level] || 'var(--text-dim)',
                        padding: '1px 6px', borderRadius: 4,
                        border: `1px solid ${RISK_TEXT[s.risk_level] || 'var(--border)'}30`
                      }}>{s.risk_level} risk</span>
                    )}

                    {/* Diff stats */}
                    {s.lines_added !== undefined && s.lines_added > 0 && (
                      <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--green)', fontWeight: 600 }}>
                        +{s.lines_added}
                      </span>
                    )}
                    {s.lines_removed !== undefined && s.lines_removed > 0 && (
                      <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--red)', fontWeight: 600 }}>
                        -{s.lines_removed}
                      </span>
                    )}

                    {/* Status pill */}
                    <span style={{
                      marginLeft: 'auto', fontSize: 10,
                      color: status.color,
                      fontFamily: 'var(--font-mono)', fontWeight: 600
                    }}>{status.text}</span>
                  </div>

                  {/* Review diff button */}
                  {s.status === 'pending_review' && s.diff_id && onReviewDiff && (
                    <button
                      onClick={() => onReviewDiff(s.diff_id!)}
                      style={{
                        marginTop: 6,
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        padding: '4px 10px', fontSize: 11, fontWeight: 600,
                        background: 'rgba(96,165,250,0.08)',
                        color: 'var(--blue)',
                        border: '1px solid rgba(96,165,250,0.2)',
                        borderRadius: 6, cursor: 'pointer',
                        fontFamily: 'var(--font-display)',
                        transition: 'all 0.15s',
                      }}
                      onMouseEnter={e => {
                        ;(e.currentTarget as HTMLElement).style.background = 'rgba(96,165,250,0.15)'
                      }}
                      onMouseLeave={e => {
                        ;(e.currentTarget as HTMLElement).style.background = 'rgba(96,165,250,0.08)'
                      }}
                    >
                      Review diff →
                    </button>
                  )}

                  {/* Error message */}
                  {s.status === 'error' && s.error && (
                    <div style={{
                      marginTop: 5, fontSize: 11,
                      color: 'var(--red)', fontFamily: 'var(--font-mono)',
                      background: 'rgba(248,113,113,0.06)',
                      border: '1px solid rgba(248,113,113,0.15)',
                      borderRadius: 5, padding: '4px 8px',
                      lineHeight: 1.5
                    }}>{s.error}</div>
                  )}

                  {/* Done output */}
                  {s.status === 'done' && s.output && (
                    <div style={{
                      marginTop: 4, fontSize: 11,
                      color: 'var(--text-muted)', lineHeight: 1.4
                    }}>{s.output}</div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
