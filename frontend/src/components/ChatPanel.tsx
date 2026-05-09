/**
 * ChatPanel.tsx
 * Drop-in replacement for the chat section inside ProjectPage.
 *
 * Features:
 *  - WhatsApp-style layout: sender's messages on RIGHT, others on LEFT
 *  - Agent messages: distinct card style with plan/steps inline
 *  - System messages: centered pill
 *  - Agent typing indicator
 *  - No-key banner
 *  - Polished input bar with auto-resize textarea
 *
 * Props mirror exactly what ProjectPage already passes inline.
 */

import React, { useRef, useEffect, useState } from 'react'
import {
  Send, Bot, Zap, X, Users, CheckCircle, XCircle,
  Clock, Loader, ChevronRight, AlertTriangle
} from 'lucide-react'
import AgentSteps, { Step } from './AgentSteps'

// ── Types (copied from ProjectPage so ChatPanel is self-contained) ────────────

export interface ChatMessage {
  id: string
  author_name: string
  author_id?: string
  avatar_color?: string
  content: string
  is_agent: boolean
  agent_model?: string
  triggered_by?: string
  timestamp: string
  type?: string
  _planMsg?: {
    job_id: string
    goal: string
    steps: Step[]
    username: string
    avatarColor: string
  }
}

interface Member {
  id: string
  username: string
  avatar_color: string
  model: string
}

interface ModelDef {
  id: string
  name: string
  provider: string
  tier: string
  available: boolean
}

interface NoKeyBanner {
  provider: string
  key_url: string
  model: string
}

interface ChatPanelProps {
  // Data
  messages: ChatMessage[]
  agentTyping: { username: string; model: string } | null
  activeJobs: Record<string, { goal: string; steps: Step[] }>
  connected: boolean
  project: { id: string; name: string; members: Member[] } | null
  currentUserId: string | undefined
  models: ModelDef[]
  noKeyBanner: NoKeyBanner | null

  // Actions
  input: string
  onInputChange: (v: string) => void
  onSend: () => void
  onReviewDiff: (diffId: string) => void
  onDismissBanner: () => void
  onNavigateProfile: () => void
  inputRef: React.RefObject<HTMLTextAreaElement>
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function modelName(id: string, models: ModelDef[]) {
  return models.find(m => m.id === id)?.name || id
}

function formatTime(ts: string) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDate(ts: string) {
  const d = new Date(ts)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return 'Today'
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

// Group messages by date for date separators
function groupByDate(messages: ChatMessage[]) {
  const groups: { date: string; messages: ChatMessage[] }[] = []
  let currentDate = ''
  for (const msg of messages) {
    const date = formatDate(msg.timestamp)
    if (date !== currentDate) {
      currentDate = date
      groups.push({ date, messages: [msg] })
    } else {
      groups[groups.length - 1].messages.push(msg)
    }
  }
  return groups
}

/** Lightweight markdown renderer for agent chat messages */
function renderMarkdown(text: string): React.ReactNode {
  const parts = text.split(/(```[\s\S]*?```)/g)
  return parts.map((part, i) => {
    const codeMatch = part.match(/^```(\w*)?\n?([\s\S]*?)```$/)
    if (codeMatch) {
      const lang = codeMatch[1] || ''
      const code = codeMatch[2].replace(/\n$/, '')
      return (
        <div key={i} style={{ margin: '6px 0', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
          {lang && (
            <div style={{ padding: '4px 10px', background: 'rgba(255,255,255,0.04)', fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid var(--border)' }}>
              {lang}
            </div>
          )}
          <pre style={{ margin: 0, padding: '10px 12px', background: '#0d1117', color: '#e6edf3', fontSize: 12, fontFamily: "'JetBrains Mono', 'Fira Code', monospace", lineHeight: 1.6, overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {code}
          </pre>
        </div>
      )
    }
    const segments = part.split(/(\*\*[^*]+\*\*|`[^`]+`|_[^_]+_)/g)
    return segments.map((seg, j) => {
      if (seg.startsWith('**') && seg.endsWith('**')) return <strong key={`${i}-${j}`}>{seg.slice(2, -2)}</strong>
      if (seg.startsWith('`') && seg.endsWith('`')) {
        return (
          <code key={`${i}-${j}`} style={{ background: 'rgba(45,212,191,0.1)', color: 'var(--teal)', padding: '1px 5px', borderRadius: 4, fontFamily: 'var(--font-mono)', fontSize: '0.9em' }}>
            {seg.slice(1, -1)}
          </code>
        )
      }
      if (seg.startsWith('_') && seg.endsWith('_') && seg.length > 2) return <em key={`${i}-${j}`}>{seg.slice(1, -1)}</em>
      return seg
    })
  })
}

// ── Sub-components ────────────────────────────────────────────────────────────

/** Date separator pill */
function DateSeparator({ label }: { label: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 0', flexShrink: 0
    }}>
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
      <span style={{
        fontSize: 10, fontWeight: 600, color: 'var(--text-dim)',
        fontFamily: 'var(--font-mono)', letterSpacing: '0.06em',
        textTransform: 'uppercase', whiteSpace: 'nowrap',
        padding: '3px 10px', background: 'var(--bg2)',
        border: '1px solid var(--border)', borderRadius: 20
      }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
    </div>
  )
}

/** System / info message — centered pill */
function SystemMessage({ content, type }: { content: string; type?: string }) {
  const isError = type === 'agent_error'
  return (
    <div style={{
      display: 'flex', justifyContent: 'center', padding: '2px 0', flexShrink: 0
    }}>
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '4px 12px', borderRadius: 20,
        background: isError ? 'rgba(248,113,113,0.08)' : 'var(--bg2)',
        border: `1px solid ${isError ? 'rgba(248,113,113,0.2)' : 'var(--border)'}`,
        fontSize: 11, color: isError ? 'var(--red)' : 'var(--text-dim)',
        fontFamily: 'var(--font-mono)', maxWidth: '85%', textAlign: 'center',
        lineHeight: 1.4
      }}>
        {isError && <AlertTriangle size={11} />}
        {content}
      </div>
    </div>
  )
}

/** Human message bubble — right for self, left for others */
function HumanBubble({
  msg, isSelf, memberColor
}: {
  msg: ChatMessage
  isSelf: boolean
  memberColor: string
}) {
  const [hovered, setHovered] = useState(false)

  return (
    <div style={{
      display: 'flex',
      flexDirection: isSelf ? 'row-reverse' : 'row',
      alignItems: 'flex-end',
      gap: 8,
      flexShrink: 0,
      animation: 'msgSlideIn 0.18s ease-out',
    }}>
      {/* Avatar — only shown on left side (others) */}
      {!isSelf && (
        <div style={{
          width: 28, height: 28, borderRadius: '50%',
          background: memberColor,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, fontWeight: 700, color: '#fff',
          flexShrink: 0, marginBottom: 2
        }}>
          {msg.author_name[0]?.toUpperCase()}
        </div>
      )}

      <div style={{
        display: 'flex', flexDirection: 'column',
        alignItems: isSelf ? 'flex-end' : 'flex-start',
        maxWidth: '75%', gap: 2
      }}>
        {/* Name — only for others */}
        {!isSelf && (
          <span style={{
            fontSize: 11, fontWeight: 600,
            color: memberColor,
            paddingLeft: 4
          }}>{msg.author_name}</span>
        )}

        {/* Bubble */}
        <div
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{
            padding: '9px 13px',
            borderRadius: isSelf
              ? '16px 4px 16px 16px'
              : '4px 16px 16px 16px',
            background: isSelf
              ? 'var(--teal)'
              : 'var(--bg3)',
            border: isSelf
              ? 'none'
              : '1px solid var(--border)',
            color: isSelf ? '#0a0d10' : 'var(--text)',
            fontSize: 13, lineHeight: 1.55,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            boxShadow: isSelf
              ? '0 2px 12px rgba(45,212,191,0.2)'
              : '0 1px 4px rgba(0,0,0,0.15)',
            transition: 'box-shadow 0.15s',
            position: 'relative',
          }}
        >
          {msg.content}
        </div>

        {/* Timestamp */}
        <span style={{
          fontSize: 10, color: 'var(--text-dim)',
          fontFamily: 'var(--font-mono)',
          paddingLeft: isSelf ? 0 : 4,
          paddingRight: isSelf ? 4 : 0,
          opacity: hovered ? 1 : 0,
          transition: 'opacity 0.15s',
        }}>
          {formatTime(msg.timestamp)}
        </span>
      </div>
    </div>
  )
}

/** Agent bubble — always on the left, distinct card style */
function AgentBubble({
  msg, activeJobs, models, onReviewDiff
}: {
  msg: ChatMessage
  activeJobs: Record<string, { goal: string; steps: Step[] }>
  models: ModelDef[]
  onReviewDiff: (diffId: string) => void
}) {
  const [hovered, setHovered] = useState(false)
  const color = msg.avatar_color || '#a78bfa'

  // Plan message — render AgentSteps card
  if (msg._planMsg) {
    const { job_id, goal, username, avatarColor } = msg._planMsg
    const liveJob = activeJobs[job_id]
    const steps = liveJob ? liveJob.steps : msg._planMsg.steps

    return (
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 8,
        flexShrink: 0, animation: 'msgSlideIn 0.18s ease-out'
      }}>
        {/* Agent avatar */}
        <div style={{
          width: 28, height: 28, borderRadius: 8, flexShrink: 0,
          background: avatarColor + '20',
          border: `1.5px solid ${avatarColor}50`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginTop: 2
        }}>
          <Bot size={14} color={avatarColor} />
        </div>

        <div style={{ flex: 1, maxWidth: '90%' }}>
          {/* Agent label */}
          <div style={{
            fontSize: 11, fontWeight: 700, color: 'var(--purple)',
            marginBottom: 5, display: 'flex', alignItems: 'center', gap: 6
          }}>
            {username}'s Agent
            <span style={{
              fontWeight: 400, color: 'var(--text-dim)',
              fontFamily: 'var(--font-mono)', fontSize: 10,
              background: 'var(--purple-dim)', border: '1px solid rgba(167,139,250,0.15)',
              padding: '1px 6px', borderRadius: 4
            }}>agent plan</span>
          </div>

          {/* Steps card */}
          <div style={{
            background: 'var(--bg2)',
            border: '1px solid var(--border)',
            borderLeft: `3px solid var(--purple)`,
            borderRadius: '4px 12px 12px 12px',
            padding: 12, boxShadow: '0 2px 12px rgba(0,0,0,0.12)'
          }}>
            <AgentSteps
              goal={goal}
              steps={steps}
              username={username}
              avatarColor={avatarColor}
              onReviewDiff={onReviewDiff}
            />
          </div>

          <span style={{
            fontSize: 10, color: 'var(--text-dim)',
            fontFamily: 'var(--font-mono)', paddingLeft: 2, marginTop: 3,
            display: 'block'
          }}>{formatTime(msg.timestamp)}</span>
        </div>
      </div>
    )
  }

  // Regular agent text message
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-end', gap: 8,
      flexShrink: 0, animation: 'msgSlideIn 0.18s ease-out'
    }}>
      <div style={{
        width: 28, height: 28, borderRadius: 8, flexShrink: 0,
        background: color + '20', border: `1.5px solid ${color}50`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 2
      }}>
        <Bot size={14} color={color} />
      </div>

      <div style={{
        display: 'flex', flexDirection: 'column',
        alignItems: 'flex-start', maxWidth: '82%', gap: 2
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 4
        }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--purple)' }}>
            {msg.author_name}
          </span>
          {msg.agent_model && (
            <span style={{
              fontSize: 10, fontFamily: 'var(--font-mono)',
              color: 'var(--text-dim)', background: 'var(--purple-dim)',
              border: '1px solid rgba(167,139,250,0.12)',
              padding: '1px 6px', borderRadius: 4
            }}>{modelName(msg.agent_model, models)}</span>
          )}
        </div>

        <div
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{
            padding: '10px 14px',
            borderRadius: '4px 16px 16px 16px',
            background: 'var(--bg3)',
            border: '1px solid var(--border)',
            borderLeft: `3px solid ${color}80`,
            color: 'var(--text)',
            fontSize: 13, lineHeight: 1.6,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
          }}
        >
          {renderMarkdown(msg.content)}
        </div>

        <span style={{
          fontSize: 10, color: 'var(--text-dim)',
          fontFamily: 'var(--font-mono)', paddingLeft: 4,
          opacity: hovered ? 1 : 0, transition: 'opacity 0.15s'
        }}>
          {formatTime(msg.timestamp)}
        </span>
      </div>
    </div>
  )
}

/** Thinking indicator — three animated dots */
function TypingIndicator({ username }: { username: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-end', gap: 8,
      flexShrink: 0
    }}>
      <div style={{
        width: 28, height: 28, borderRadius: 8,
        background: 'var(--purple-dim)',
        border: '1.5px solid rgba(167,139,250,0.3)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Bot size={14} color="var(--purple)" />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start' }}>
        <span style={{
          fontSize: 11, fontWeight: 700, color: 'var(--purple)', paddingLeft: 4
        }}>{username}'s Agent</span>
        <div style={{
          padding: '10px 14px',
          borderRadius: '4px 16px 16px 16px',
          background: 'var(--bg3)',
          border: '1px solid var(--border)',
          borderLeft: '3px solid rgba(167,139,250,0.5)',
          display: 'flex', alignItems: 'center', gap: 4
        }}>
          <span className="typing-dot" />
          <span className="typing-dot" />
          <span className="typing-dot" />
        </div>
      </div>
    </div>
  )
}

// ── Main ChatPanel ────────────────────────────────────────────────────────────

export default function ChatPanel({
  messages, agentTyping, activeJobs, connected,
  project, currentUserId, models, noKeyBanner,
  input, onInputChange, onSend, onReviewDiff,
  onDismissBanner, onNavigateProfile, inputRef
}: ChatPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const groups = groupByDate(messages)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, agentTyping])

  // Auto-resize textarea
  function handleTextareaChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    onInputChange(e.target.value)
    e.target.style.height = 'auto'
    e.target.style.height = Math.min(e.target.scrollHeight, 140) + 'px'
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSend()
      // Reset height
      if (inputRef.current) {
        inputRef.current.style.height = 'auto'
      }
    }
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: '100%', overflow: 'hidden',
      background: 'var(--bg1)'
    }}>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center',
        justifyContent: 'space-between',
        padding: '11px 16px',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
        background: 'var(--bg1)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Connection dot */}
          <div style={{ position: 'relative', width: 8, height: 8 }}>
            <div style={{
              width: 8, height: 8, borderRadius: '50%',
              background: connected ? 'var(--green)' : 'var(--red)',
            }} />
            {connected && (
              <div style={{
                position: 'absolute', inset: 0,
                borderRadius: '50%',
                background: 'var(--green)',
                animation: 'livePulse 2s ease-out infinite',
                opacity: 0.4
              }} />
            )}
          </div>
          <div>
            <span style={{ fontWeight: 700, fontSize: 14, letterSpacing: '-0.01em' }}>
              # {project?.name || '...'}
            </span>
            {project && (
              <span style={{
                marginLeft: 8, fontSize: 11,
                color: 'var(--text-dim)', fontFamily: 'var(--font-mono)'
              }}>
                {project.members.length} member{project.members.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
        <span style={{
          fontSize: 10, fontFamily: 'var(--font-mono)',
          color: connected ? 'var(--green)' : 'var(--red)',
          background: connected ? 'rgba(52,211,153,0.08)' : 'rgba(248,113,113,0.08)',
          border: `1px solid ${connected ? 'rgba(52,211,153,0.2)' : 'rgba(248,113,113,0.2)'}`,
          padding: '3px 8px', borderRadius: 20,
          textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600
        }}>
          {connected ? 'live' : 'offline'}
        </span>
      </div>

      {/* ── No API key banner ────────────────────────────────────────────── */}
      {noKeyBanner && (
        <div style={{
          background: 'linear-gradient(135deg, rgba(251,191,36,0.08), rgba(251,191,36,0.04))',
          borderBottom: '1px solid rgba(251,191,36,0.2)',
          padding: '10px 14px', flexShrink: 0
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 8, flexShrink: 0,
              background: 'rgba(251,191,36,0.12)',
              border: '1px solid rgba(251,191,36,0.25)',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <span style={{ fontSize: 14 }}>🔑</span>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--amber)', marginBottom: 3 }}>
                No {noKeyBanner.provider.charAt(0).toUpperCase() + noKeyBanner.provider.slice(1)} API key
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                Add your key at{' '}
                <a href={noKeyBanner.key_url} target="_blank" rel="noopener noreferrer"
                   style={{ color: 'var(--accent)', fontWeight: 600 }}>
                  {noKeyBanner.key_url.replace('https://', '')}
                </a>
                {' '}then{' '}
                <button onClick={onNavigateProfile}
                  style={{ background: 'none', border: 'none', padding: 0, color: 'var(--accent)', fontWeight: 600, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                  save it in Profile →
                </button>
              </div>
            </div>
            <button onClick={onDismissBanner}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', padding: 2, flexShrink: 0 }}>
              <X size={13} />
            </button>
          </div>
          <button onClick={onNavigateProfile}
            style={{
              marginTop: 8, width: '100%',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              padding: '7px 12px',
              background: 'var(--amber)', border: 'none', borderRadius: 8,
              color: '#000', fontWeight: 700, fontSize: 12, cursor: 'pointer',
              fontFamily: 'var(--font-display)'
            }}>
            <Zap size={13} /> Add API Key →
          </button>
        </div>
      )}

      {/* ── Messages area ────────────────────────────────────────────────── */}
      <div style={{
        flex: 1, overflow: 'auto',
        padding: '12px 14px',
        display: 'flex', flexDirection: 'column', gap: 6,
        // Custom scrollbar
        scrollbarWidth: 'thin',
      }}>

        {/* Empty state */}
        {messages.length === 0 && (
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            gap: 12, color: 'var(--text-dim)', textAlign: 'center',
            padding: 24
          }}>
            <div style={{
              width: 56, height: 56, borderRadius: 16,
              background: 'var(--bg3)', border: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ fontSize: 26 }}>⬡</span>
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>
                No messages yet
              </div>
              <p style={{ fontSize: 12, lineHeight: 1.6 }}>
                Chat with teammates or use{' '}
                <code style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>@agent</code>
                {' '}to invoke AI.
              </p>
            </div>
          </div>
        )}

        {/* Grouped messages by date */}
        {groups.map(group => (
          <React.Fragment key={group.date}>
            <DateSeparator label={group.date} />

            {group.messages.map(msg => {
              // System / error
              if (msg.type === 'system' || msg.type === 'agent_error') {
                return <SystemMessage key={msg.id} content={msg.content} type={msg.type} />
              }

              // Agent messages (plan or regular)
              if (msg.is_agent) {
                return (
                  <AgentBubble
                    key={msg.id}
                    msg={msg}
                    activeJobs={activeJobs}
                    models={models}
                    onReviewDiff={onReviewDiff}
                  />
                )
              }

              // Human messages
              const isSelf = msg.author_id === currentUserId
              const member = (msg as any)._member
              const color = msg.avatar_color || '#6366f1'

              return (
                <HumanBubble
                  key={msg.id}
                  msg={msg}
                  isSelf={isSelf}
                  memberColor={color}
                />
              )
            })}
          </React.Fragment>
        ))}

        {/* Typing indicator */}
        {agentTyping && <TypingIndicator username={agentTyping.username} />}

        <div ref={bottomRef} />
      </div>

      {/* ── Input bar ────────────────────────────────────────────────────── */}
      <div style={{
        flexShrink: 0,
        borderTop: '1px solid var(--border)',
        background: 'var(--bg1)',
      }}>

        {/* Agent quick-action chips */}
        <div style={{
          display: 'flex', gap: 6, padding: '8px 12px 0',
          overflowX: 'auto',
          scrollbarWidth: 'none',
        }}>
          {[
            { label: '@agent create file', icon: '📄' },
            { label: '@agent modify', icon: '✏️' },
            { label: '@agent explain', icon: '💬' },
            { label: '@agent scaffold', icon: '🏗️' },
          ].map(chip => (
            <button
              key={chip.label}
              onClick={() => {
                // Append chip text to input
                const newVal = input + chip.label + ' '
                onInputChange(newVal)
                inputRef.current?.focus()
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '4px 10px',
                background: 'var(--bg3)',
                border: '1px solid var(--border)',
                borderRadius: 20,
                color: 'var(--text-muted)', fontSize: 11,
                fontFamily: 'var(--font-mono)', cursor: 'pointer',
                whiteSpace: 'nowrap', flexShrink: 0,
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => {
                ;(e.currentTarget as HTMLElement).style.borderColor = 'var(--teal)'
                ;(e.currentTarget as HTMLElement).style.color = 'var(--teal)'
              }}
              onMouseLeave={e => {
                ;(e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'
                ;(e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'
              }}
            >
              <span>{chip.icon}</span> {chip.label}
            </button>
          ))}
        </div>

        {/* Input row */}
        <div style={{
          display: 'flex', alignItems: 'flex-end', gap: 8,
          padding: '8px 12px 12px'
        }}>
          {/* @agent shortcut button */}
          <button
            title="Invoke agent (@agent)"
            onClick={() => {
              onInputChange(input + '@agent ')
              inputRef.current?.focus()
            }}
            style={{
              width: 36, height: 36,
              background: 'var(--teal-dim)',
              border: '1px solid rgba(45,212,191,0.2)',
              borderRadius: 10, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0, transition: 'all 0.15s',
            }}
            onMouseEnter={e => {
              ;(e.currentTarget as HTMLElement).style.background = 'rgba(45,212,191,0.15)'
              ;(e.currentTarget as HTMLElement).style.borderColor = 'rgba(45,212,191,0.4)'
            }}
            onMouseLeave={e => {
              ;(e.currentTarget as HTMLElement).style.background = 'var(--teal-dim)'
              ;(e.currentTarget as HTMLElement).style.borderColor = 'rgba(45,212,191,0.2)'
            }}
          >
            <Zap size={15} color="var(--teal)" />
          </button>

          {/* Textarea */}
          <div style={{
            flex: 1, position: 'relative',
            background: 'var(--bg2)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            transition: 'border-color 0.15s, box-shadow 0.15s',
          }}
            onFocusCapture={e => {
              ;(e.currentTarget as HTMLElement).style.borderColor = 'var(--teal)'
              ;(e.currentTarget as HTMLElement).style.boxShadow = '0 0 0 3px rgba(45,212,191,0.08)'
            }}
            onBlurCapture={e => {
              ;(e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'
              ;(e.currentTarget as HTMLElement).style.boxShadow = 'none'
            }}
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleTextareaChange}
              onKeyDown={handleKey}
              rows={1}
              placeholder="Message teammates or @agent create utils.py…"
              style={{
                width: '100%', display: 'block',
                background: 'transparent',
                border: 'none', outline: 'none',
                padding: '9px 12px',
                color: 'var(--text)', fontSize: 13,
                fontFamily: 'var(--font-display)',
                lineHeight: 1.5, resize: 'none',
                maxHeight: 140, overflowY: 'auto',
              }}
            />
          </div>

          {/* Send button */}
          <button
            onClick={onSend}
            disabled={!input.trim() || !connected}
            title="Send (Enter)"
            style={{
              width: 36, height: 36,
              background: input.trim() && connected ? 'var(--teal)' : 'var(--bg3)',
              border: `1px solid ${input.trim() && connected ? 'rgba(45,212,191,0.3)' : 'var(--border)'}`,
              borderRadius: 10, cursor: input.trim() && connected ? 'pointer' : 'not-allowed',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
              transition: 'all 0.15s',
              boxShadow: input.trim() && connected ? '0 2px 12px rgba(45,212,191,0.25)' : 'none',
            }}
          >
            <Send size={15} color={input.trim() && connected ? '#0a0d10' : 'var(--text-dim)'} />
          </button>
        </div>

        {/* Hint */}
        <div style={{
          padding: '0 14px 8px',
          fontSize: 10, color: 'var(--text-dim)',
          fontFamily: 'var(--font-mono)',
          display: 'flex', gap: 12
        }}>
          <span><kbd style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 3, padding: '1px 4px', fontSize: 9 }}>Enter</kbd> send</span>
          <span><kbd style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 3, padding: '1px 4px', fontSize: 9 }}>Shift+Enter</kbd> newline</span>
        </div>
      </div>

      {/* Keyframe animations injected once */}
      <style>{`
        @keyframes msgSlideIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes livePulse {
          0%   { transform: scale(1);   opacity: 0.6; }
          70%  { transform: scale(2.2); opacity: 0; }
          100% { transform: scale(2.2); opacity: 0; }
        }
      `}</style>
    </div>
  )
}
