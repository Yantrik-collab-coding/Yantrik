import React from 'react'
import { Bot, CheckCircle, XCircle, Clock, Loader } from 'lucide-react'

export interface Step {
  step_number: number
  action:      string
  target_file?: string
  status:      'running' | 'done' | 'error' | 'pending_review' | 'pending'
  output?:     string
  diff_id?:    string
  lines_added?: number
  lines_removed?: number
  risk_level?:  string
  error?:       string
}

interface Props {
  goal:     string
  steps:    Step[]
  username: string
  avatarColor: string
  onReviewDiff?: (diffId: string) => void
}

const ACTION_LABELS: Record<string, string> = {
  create_file:  '📄 Create file',
  modify_file:  '✏️ Modify file',
  explain:      '💬 Explain',
}

function StepIcon({ status }: { status: string }) {
  if (status === 'running')        return <Loader size={13} className="step-running" style={{ animation: 'spin 1s linear infinite' }} />
  if (status === 'done')           return <CheckCircle size={13} className="step-done" />
  if (status === 'pending_review') return <Clock size={13} className="step-pending" />
  if (status === 'error')          return <XCircle size={13} className="step-error" />
  return <Clock size={13} style={{ color: 'var(--text-dim)' }} />
}

export default function AgentSteps({ goal, steps, username, avatarColor, onReviewDiff }: Props) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <div style={{
        width: 28, height: 28, borderRadius: 8, flexShrink: 0,
        background: avatarColor + '22', border: `1px solid ${avatarColor}44`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 2
      }}>
        <Bot size={14} color={avatarColor} />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--purple)', marginBottom: 6 }}>
          {username}'s Agent &nbsp;
          <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>planning</span>
        </div>
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10, fontStyle: 'italic' }}>{goal}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {steps.map(s => (
              <div key={s.step_number} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <div style={{ paddingTop: 1 }}><StepIcon status={s.status} /></div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{s.step_number}.</span>
                    <span style={{ color: 'var(--text-muted)' }}>{ACTION_LABELS[s.action] || s.action}</span>
                    {s.target_file && (
                      <code style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{s.target_file}</code>
                    )}
                    {s.risk_level && (
                      <span className={`tag risk-${s.risk_level}`} style={{ fontSize: 10 }}>{s.risk_level}</span>
                    )}
                    {(s.lines_added !== undefined) && (
                      <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--green)' }}>+{s.lines_added}</span>
                    )}
                    {(s.lines_removed !== undefined && s.lines_removed > 0) && (
                      <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--red)' }}>-{s.lines_removed}</span>
                    )}
                  </div>
                  {s.status === 'pending_review' && s.diff_id && onReviewDiff && (
                    <button
                      className="btn btn-sm"
                      style={{ marginTop: 4, fontSize: 11, padding: '3px 8px', background: 'var(--blue-dim)', color: 'var(--blue)', border: '1px solid #60a5fa33' }}
                      onClick={() => onReviewDiff(s.diff_id!)}
                    >
                      Review diff →
                    </button>
                  )}
                  {s.status === 'error' && s.error && (
                    <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 3, fontFamily: 'var(--font-mono)' }}>{s.error}</div>
                  )}
                  {s.status === 'done' && s.output && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>{s.output}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
