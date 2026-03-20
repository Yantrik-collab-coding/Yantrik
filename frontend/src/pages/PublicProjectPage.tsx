import React, { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Eye, Users, Bot, MessageSquare, Send, Lock, Check, X, Globe, Zap, Clock } from 'lucide-react'
import api from '../lib/api'
import { useAuthStore } from '../lib/store'

interface Message {
  id: string; author_name: string; author_id?: string; avatar_color?: string
  content: string; is_agent: boolean; agent_model?: string; created_at: string; type?: string
}
interface Member { id: string; username: string; avatar_color: string; model: string; role: string }
interface Project {
  id: string; name: string; description: string; tags: string
  owner_name: string; owner_color: string
  member_count: number; viewer_count: number; agent_calls: number
  members: Member[]
}
interface JoinReq { id: string; user_id: string; username: string; avatar_color: string; message: string; created_at: string }

export default function PublicProjectPage() {
  const { id }      = useParams<{ id: string }>()
  const navigate     = useNavigate()
  const { user, token } = useAuthStore()
  const [project, setProject]         = useState<Project | null>(null)
  const [messages, setMessages]       = useState<Message[]>([])
  const [viewerCount, setViewerCount] = useState(0)
  const [isMember, setIsMember]       = useState(false)
  const [isOwner, setIsOwner]         = useState(false)
  const [requestSent, setRequestSent] = useState(false)
  const [requestMsg, setRequestMsg]   = useState('')
  const [showRequest, setShowRequest] = useState(false)
  const [joinReqs, setJoinReqs]       = useState<JoinReq[]>([])
  const [showReqs, setShowReqs]       = useState(false)
  const [input, setInput]             = useState('')
  const [connected, setConnected]     = useState(false)
  const wsRef    = useRef<WebSocket | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!id) return
    loadProject()
    loadMessages()
    registerViewer()
    return () => { unregisterViewer() }
  }, [id])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Connect WebSocket if member
  useEffect(() => {
    if (!isMember || !token || !id) return
    const ws = new WebSocket(
      `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws/${id}?token=${token}`
    )
    wsRef.current = ws
    ws.onopen  = () => setConnected(true)
    ws.onclose = () => setConnected(false)
    ws.onmessage = e => {
      const data = JSON.parse(e.data)
      if (data.type === 'message') {
        setMessages(prev => [...prev, { ...data, created_at: data.timestamp }])
      }
    }
    return () => ws.close()
  }, [isMember, token, id])

  async function loadProject() {
    try {
      const { data } = await api.get(`/forum/${id}`)
      setProject(data)
      setViewerCount(data.viewer_count)
      if (user) {
        const me = data.members.find((m: Member) => m.id === user.id)
        setIsMember(!!me)
        setIsOwner(me?.role === 'owner')
      }
    } catch { navigate('/forum') }
  }

  async function loadMessages() {
    try {
      const { data } = await api.get(`/projects/${id}/messages`)
      setMessages(data)
    } catch {}
  }

  async function loadJoinRequests() {
    const { data } = await api.get(`/forum/${id}/requests`)
    setJoinReqs(data)
  }

  async function registerViewer() {
    try {
      const { data } = await api.post(`/forum/${id}/view`)
      setViewerCount(data.viewer_count)
    } catch {}
  }

  async function unregisterViewer() {
    try { await api.delete(`/forum/${id}/view`) } catch {}
  }

  async function sendJoinRequest() {
    await api.post(`/forum/${id}/request`, { message: requestMsg })
    setRequestSent(true)
    setShowRequest(false)
  }

  async function approve(userId: string) {
    await api.post(`/forum/${id}/approve/${userId}`)
    setJoinReqs(prev => prev.filter(r => r.user_id !== userId))
  }

  async function reject(userId: string) {
    await api.post(`/forum/${id}/reject/${userId}`)
    setJoinReqs(prev => prev.filter(r => r.user_id !== userId))
  }

  function sendMessage() {
    if (!input.trim() || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
    wsRef.current.send(JSON.stringify({ type: 'message', content: input.trim() }))
    setInput('')
  }

  const formatTime = (ts: string) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  return (
    <div style={S.root}>
      {/* Sidebar */}
      <div style={S.sidebar}>
        <button className="btn btn-ghost" style={{ justifyContent: 'flex-start', marginBottom: 12 }} onClick={() => navigate('/forum')}>
          <ArrowLeft size={15} /> Open Forum
        </button>

        {project && (
          <>
            <div style={S.projectInfo}>
              <div style={{ ...S.projectIcon, background: project.owner_color + '33', color: project.owner_color }}>
                {project.name[0].toUpperCase()}
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{project.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>by {project.owner_name}</div>
              </div>
            </div>

            {project.description && (
              <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>{project.description}</p>
            )}

            {project.tags && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {project.tags.split(',').map(t => t.trim()).filter(Boolean).map(tag => (
                  <span key={tag} className="tag tag-blue" style={{ fontSize: 10 }}>#{tag}</span>
                ))}
              </div>
            )}

            {/* Stats */}
            <div style={S.statsBox}>
              {[
                [<Eye size={12} />, `${viewerCount} watching`],
                [<Users size={12} />, `${project.member_count} members`],
                [<Bot size={12} />, `${project.agent_calls} agent calls`],
              ].map(([icon, label]: any, i) => (
                <div key={i} style={S.statRow}>{icon}<span>{label}</span></div>
              ))}
            </div>

            {/* Members */}
            <div style={S.section}>
              <div style={S.sectionTitle}><Users size={11} /> Members</div>
              {project.members.map(m => (
                <div key={m.id} style={S.memberRow}>
                  <div style={{ ...S.avatar, background: m.avatar_color }}>{m.username[0].toUpperCase()}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
                      {m.username}
                      {m.role === 'owner' && <span className="tag tag-amber" style={{ fontSize: 9 }}>owner</span>}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                      {m.model?.split('-').slice(0, 2).join(' ')}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Owner: join request management */}
            {isOwner && (
              <button
                className="btn btn-ghost"
                style={{ justifyContent: 'flex-start', fontSize: 12 }}
                onClick={async () => { await loadJoinRequests(); setShowReqs(true) }}
              >
                <Users size={13} /> Manage Requests
              </button>
            )}

            {/* Non-member: request to join */}
            {!isMember && user && !requestSent && (
              <button className="btn btn-primary" style={{ justifyContent: 'center' }} onClick={() => setShowRequest(true)}>
                <Zap size={13} /> Request to Join
              </button>
            )}
            {requestSent && (
              <div style={{ fontSize: 12, color: 'var(--green)', fontFamily: 'var(--font-mono)', textAlign: 'center' }}>
                ✓ Request sent — waiting for approval
              </div>
            )}
            {!user && (
              <button className="btn btn-ghost" style={{ justifyContent: 'center', fontSize: 12 }} onClick={() => navigate('/auth')}>
                Sign in to request access
              </button>
            )}
          </>
        )}
      </div>

      {/* Chat area */}
      <div style={S.chat}>
        <div style={S.chatHeader}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Globe size={15} color="var(--accent2)" />
            <span style={{ fontWeight: 700, fontSize: 15 }}># {project?.name}</span>
            {isMember && (
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: connected ? 'var(--green)' : 'var(--red)' }} />
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 4 }}>
              <Eye size={12} /> {viewerCount} watching
            </span>
            {!isMember && (
              <span style={S.readOnlyBadge}><Lock size={10} /> Read Only</span>
            )}
          </div>
        </div>

        {/* Messages */}
        <div style={S.messages}>
          {messages.length === 0 && (
            <div style={S.emptyChat}>
              <Globe size={36} color="var(--text-dim)" />
              <p>No messages yet. Be the first to start the conversation.</p>
            </div>
          )}
          {messages.map(msg => {
            if (msg.type === 'system') {
              return <div key={msg.id} style={S.systemMsg}>{msg.content}</div>
            }
            const color = msg.avatar_color || '#6366f1'
            return (
              <div key={msg.id} style={S.msgRow}>
                {!msg.is_agent
                  ? <div style={{ ...S.avatar, background: color, alignSelf: 'flex-start', marginTop: 2 }}>{msg.author_name[0]?.toUpperCase()}</div>
                  : <div style={{ ...S.agentAvatar, background: color + '33', border: `1px solid ${color}44`, alignSelf: 'flex-start', marginTop: 2 }}><Bot size={13} color={color} /></div>
                }
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: msg.is_agent ? 'var(--purple)' : color }}>
                      {msg.author_name}
                    </span>
                    {msg.is_agent && msg.agent_model && (
                      <span className="tag tag-purple" style={{ fontSize: 10 }}>{msg.agent_model?.split('-').slice(0,2).join(' ')}</span>
                    )}
                    <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                      {formatTime(msg.created_at)}
                    </span>
                  </div>
                  <div style={{ ...S.msgContent, ...(msg.is_agent ? S.agentContent : {}) }}>
                    {msg.content}
                  </div>
                </div>
              </div>
            )
          })}
          <div ref={bottomRef} />
        </div>

        {/* Input — only for members */}
        {isMember ? (
          <div style={S.inputArea}>
            <textarea
              style={S.textarea}
              placeholder={`Message #${project?.name} — use @agent to invoke AI`}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
              rows={1}
            />
            <button style={{ ...S.sendBtn, opacity: input.trim() ? 1 : 0.4 }} onClick={sendMessage}>
              <Send size={15} />
            </button>
          </div>
        ) : (
          <div style={S.readOnlyBar}>
            <Lock size={14} color="var(--text-dim)" />
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              You're in read-only mode —
            </span>
            {user
              ? <button className="btn btn-primary" style={{ padding: '6px 14px', fontSize: 12 }} onClick={() => setShowRequest(true)}>Request write access</button>
              : <button className="btn btn-ghost" style={{ padding: '6px 14px', fontSize: 12 }} onClick={() => navigate('/auth')}>Sign in to request access</button>
            }
          </div>
        )}
      </div>

      {/* Request to join modal */}
      {showRequest && (
        <div style={S.overlay} onClick={() => setShowRequest(false)}>
          <div className="card" style={S.modal} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>Request Write Access</h2>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
              The project owner will review your request. Leave a message to introduce yourself.
            </p>
            <textarea
              className="input"
              placeholder="Hi! I'd like to collaborate on this project because..."
              value={requestMsg}
              onChange={e => setRequestMsg(e.target.value)}
              rows={4}
              style={{ resize: 'none', marginBottom: 16 }}
            />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setShowRequest(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={sendJoinRequest}>Send Request</button>
            </div>
          </div>
        </div>
      )}

      {/* Join requests panel (owner) */}
      {showReqs && (
        <div style={S.overlay} onClick={() => setShowReqs(false)}>
          <div className="card" style={{ ...S.modal, maxWidth: 520 }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>Join Requests ({joinReqs.length})</h2>
            {joinReqs.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>No pending requests.</p>
            ) : joinReqs.map(req => (
              <div key={req.id} style={S.reqRow}>
                <div style={{ ...S.avatar, background: req.avatar_color }}>{req.username[0].toUpperCase()}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{req.username}</div>
                  {req.message && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{req.message}</div>}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-ghost" style={{ padding: '6px', color: 'var(--green)' }} onClick={() => approve(req.user_id)}>
                    <Check size={14} />
                  </button>
                  <button className="btn btn-ghost" style={{ padding: '6px', color: 'var(--red)' }} onClick={() => reject(req.user_id)}>
                    <X size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <style>{`
        .forum-card:hover { border-color: var(--accent2) !important; transform: translateY(-2px); }
        @keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.4 } }
      `}</style>
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  root: { display: 'flex', height: '100vh', overflow: 'hidden' },
  sidebar: { width: 260, background: 'var(--bg1)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', padding: 16, gap: 14, overflow: 'auto', flexShrink: 0 },
  projectInfo: { display: 'flex', alignItems: 'center', gap: 10 },
  projectIcon: { width: 38, height: 38, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 800, flexShrink: 0 },
  statsBox: { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 },
  statRow: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-muted)' },
  section: { display: 'flex', flexDirection: 'column', gap: 8 },
  sectionTitle: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' },
  memberRow: { display: 'flex', alignItems: 'center', gap: 8 },
  avatar: { width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#fff', flexShrink: 0 },
  agentAvatar: { width: 28, height: 28, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  chat: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  chatHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid var(--border)', background: 'var(--bg1)', flexShrink: 0 },
  readOnlyBadge: { display: 'flex', alignItems: 'center', gap: 4, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 8px', fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' },
  messages: { flex: 1, overflow: 'auto', padding: '20px 20px 0', display: 'flex', flexDirection: 'column', gap: 16 },
  emptyChat: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: 'var(--text-dim)', padding: 60, textAlign: 'center' },
  systemMsg: { textAlign: 'center', fontSize: 12, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', padding: '4px 0' },
  msgRow: { display: 'flex', gap: 10 },
  msgContent: { fontSize: 14, lineHeight: 1.6, color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  agentContent: { background: 'var(--bg2)', border: '1px solid #bc8cff22', borderRadius: 8, padding: '10px 14px' },
  inputArea: { display: 'flex', alignItems: 'flex-end', gap: 10, padding: 16, borderTop: '1px solid var(--border)', background: 'var(--bg1)' },
  textarea: { flex: 1, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', color: 'var(--text)', fontSize: 14, resize: 'none', outline: 'none', fontFamily: 'var(--font-display)', lineHeight: 1.5, maxHeight: 120, transition: 'border-color 0.15s' },
  sendBtn: { background: 'var(--accent)', border: 'none', borderRadius: 8, padding: '10px 12px', cursor: 'pointer', color: '#000', display: 'flex', alignItems: 'center', flexShrink: 0 },
  readOnlyBar: { display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px', borderTop: '1px solid var(--border)', background: 'var(--bg1)' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  modal: { width: '100%', maxWidth: 480, padding: 28 },
  reqRow: { display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--border)' },
}
