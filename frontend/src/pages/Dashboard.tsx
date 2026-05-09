import React, { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  Plus, LogOut, Users, Hash, Copy, Check, Settings,
  Globe, Trophy, HelpCircle, DollarSign, Eye,
  MessageSquare, Bot, ChevronRight, Search, Code2,
  Sun, Moon
} from 'lucide-react'
import api from '../lib/api'
import { useAuthStore } from '../lib/store'

interface Project {
  id: string; name: string; description: string; owner_id: string
  invite_code: string; member_count: number; my_model: string; created_at: string
}
interface Forum {
  id: string; name: string; description: string; tags: string
  owner_name: string; owner_color: string
  member_count: number; viewer_count: number
  message_count: number; agent_count: number
  last_activity: string | null
}

const PALETTE = ['#2dd4bf','#60a5fa','#a78bfa','#f472b6','#34d399','#fb923c','#e879f9','#38bdf8']
const strColor = (s: string) => PALETTE[s.charCodeAt(0) % PALETTE.length]

function shortModel(m: string) {
  if (m?.includes('llama-3.3')) return 'Llama 3.3'
  if (m?.includes('llama-3.1-8b')) return 'Llama 8B'
  if (m?.includes('mixtral')) return 'Mixtral'
  if (m?.includes('gemma')) return 'Gemma'
  if (m?.includes('gpt-4o-mini')) return 'GPT-4o Mini'
  if (m?.includes('gpt-4o')) return 'GPT-4o'
  if (m?.includes('claude')) return 'Claude'
  if (m?.includes('gemini')) return 'Gemini'
  return 'AI'
}

function timeAgo(ts: string | null) {
  if (!ts) return ''
  const d = Math.floor((Date.now() - new Date(ts).getTime()) / 60000)
  if (d < 1) return 'now'; if (d < 60) return `${d}m`
  if (d < 1440) return `${Math.floor(d/60)}h`; return `${Math.floor(d/1440)}d`
}

const isLive = (ts: string | null) => !!ts && Date.now() - new Date(ts).getTime() < 5*60000

export default function Dashboard() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()
  const prefill = location.state as { prefillName?: string } | null
  const [projects, setProjects]       = useState<Project[]>([])
  const [forums,   setForums]         = useState<Forum[]>([])
  const [search,   setSearch]         = useState('')
  const [showCreate, setShowCreate]   = useState(false)
  const [showJoin,   setShowJoin]     = useState(false)
  const [name,     setName]           = useState(prefill?.prefillName || '')
  const [desc,     setDesc]           = useState('')
  const [code,     setCode]           = useState('')
  const [loading,  setLoading]        = useState(false)
  const [copied,   setCopied]         = useState<string|null>(null)
  const [hoveredForum, setHoveredForum] = useState<string|null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)
  const [deleteInput,  setDeleteInput]  = useState('')
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('theme') !== 'light'
    }
    return true
  })

  useEffect(() => {
    api.get('/projects/').then(r => setProjects(r.data)).catch(() => {})
    loadForums()
    const t = setInterval(loadForums, 12000)
    return () => clearInterval(t)
  }, [])

  // Auto-open create dialog when arriving with a pre-filled name (e.g. from Open Folder)
  useEffect(() => {
    if (prefill?.prefillName) setShowCreate(true)
  }, [])

  useEffect(() => {
    if (darkMode) {
      document.documentElement.setAttribute('data-theme', 'dark')
      localStorage.setItem('theme', 'dark')
    } else {
      document.documentElement.removeAttribute('data-theme')
      localStorage.setItem('theme', 'light')
    }
  }, [darkMode])

  async function loadForums() {
    try { const {data} = await api.get('/forum/'); setForums(data) } catch {}
  }

  async function createProject(e: React.FormEvent) {
    e.preventDefault(); setLoading(true)
    try {
      const {data} = await api.post('/projects/', {name, description: desc})
      setProjects(p => [{...data, member_count:1, my_model:'llama-3.3-70b-versatile'}, ...p])
      setShowCreate(false); setName(''); setDesc('')
      navigate(`/project/${data.id}`)
    } finally { setLoading(false) }
  }

  async function joinProject(e: React.FormEvent) {
    e.preventDefault(); setLoading(true)
    try {
      const {data} = await api.post(`/projects/join/${code.trim()}`)
      navigate(`/project/${data.id}`)
    } catch { alert('Invalid invite code') }
    finally { setLoading(false) }
  }

  const filtered = projects.filter(p => !search || p.name.toLowerCase().includes(search.toLowerCase()))
  const liveCount = forums.filter(f => isLive(f.last_activity)).length

  async function handleDeleteProject() {
    if (!deleteTarget || deleteInput.trim() !== deleteTarget.name) return
    setDeleteLoading(true)
    try {
      await api.delete(`/projects/${deleteTarget.id}`)
      setProjects(prev => prev.filter(p => p.id !== deleteTarget.id))
      setDeleteTarget(null)
      setDeleteInput('')
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to delete project')
    } finally {
      setDeleteLoading(false)
    }
  }

  return (
    <div style={S.root}>
      <style>{`
        @keyframes livePulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.9); }
        }
        .live-dot { animation: livePulse 2s ease-in-out infinite; }
        @keyframes modalSlideIn {
          from { opacity: 0; transform: scale(0.95) translateY(8px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        .modal-animate { animation: modalSlideIn 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
      `}</style>

      {/* ── Left Sidebar ───────────────────────────────────────────── */}
      <aside style={S.sidebar}>
        {/* Logo */}
        <div style={S.logoWrap} onClick={() => navigate('/dashboard')}>
          <img src={`${import.meta.env.BASE_URL}logo.png`} width="22" height="22" style={{ objectFit: 'contain' }} alt="Yantrik" />
        </div>

        {/* Nav Items */}
        <nav style={S.nav}>
          <button style={S.navItem} onClick={() => navigate('/dashboard')}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--bg2)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
            <Code2 size={16} />
            <span>Workspaces</span>
          </button>
          <button style={S.navItem} onClick={() => navigate('/forum')}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--bg2)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
            <Globe size={16} />
            <span>Forums</span>
          </button>
          <button style={S.navItem} onClick={() => navigate('/hackathon')}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--bg2)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
            <Trophy size={16} />
            <span>Hackathon</span>
          </button>
          {/* DISABLED — testing/friends phase: no pricing nav */}
          {/* <button style={S.navItem} onClick={() => navigate('/pricing')}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--bg2)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
            <DollarSign size={16} />
            <span>Pricing</span>
          </button> */}
          <button style={S.navItem} onClick={() => navigate('/how-to-use')}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--bg2)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
            <HelpCircle size={16} />
            <span>How to Use</span>
          </button>
        </nav>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* User Profile */}
        <div style={S.userSection}>
          <div style={S.userRow}>
            <div style={{ ...S.avatar, background: user?.avatar_color }} onClick={() => navigate('/profile')}>
              {user?.username?.[0]?.toUpperCase()}
            </div>
            <div style={S.userInfo}>
              <div style={S.userName}>{user?.username}</div>
              <div style={S.userUid}>{(user as any)?.uid || '...'}</div>
            </div>
          </div>
          <div style={S.userActions}>
            <button style={S.actionBtn} onClick={() => navigate('/profile')} title="Settings">
              <Settings size={16} />
            </button>
            <button style={S.actionBtn} onClick={() => { logout(); navigate('/auth') }} title="Sign out">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main Content ────────────────────────────────────────────── */}
      <main style={S.main}>
        {/* Header */}
        <header style={S.header}>
          <div>
            <div style={S.headerTitle}>
              <h1 style={S.heading}>Workspaces</h1>
              {projects.length > 0 && (
                <span style={S.badge}>{projects.length}</span>
              )}
            </div>
            <p style={S.subheading}>Your collaborative AI projects</p>
          </div>
          <div style={S.headerActions}>
            <button
              style={S.themeToggle}
              onClick={() => setDarkMode(d => !d)}
              title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {darkMode ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <button className="btn btn-ghost" style={S.ghostBtn} onClick={() => setShowJoin(true)}>
              <Hash size={14} />
              Join
            </button>
            <button className="btn btn-primary" style={S.primaryBtn} onClick={() => setShowCreate(true)}>
              <Plus size={14} />
              New Workspace
            </button>
          </div>
        </header>

        {/* Search Bar */}
        <div style={S.searchBar}>
          <div style={S.searchInput}>
            <Search size={14} style={S.searchIcon} />
            <input
              className="input"
              style={S.searchField}
              placeholder="Search workspaces..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Workspace Grid */}
        {projects.length === 0 ? (
          <div style={S.emptyState}>
            <div style={S.emptyIcon}>
              <img src={`${import.meta.env.BASE_URL}logo.png`} width="40" height="40" style={{ objectFit: 'contain' }} alt="Yantrik" />
            </div>
            <h2 style={S.emptyHeading}>No workspaces yet</h2>
            <p style={S.emptyText}>Create your first workspace and start building with AI</p>
            <button className="btn btn-primary" style={S.emptyBtn} onClick={() => setShowCreate(true)}>
              <Plus size={16} />
              Create First Workspace
            </button>
          </div>
        ) : (
          <div style={S.workspaceGrid}>
            {filtered.map((p, i) => (
              <div
                key={p.id}
                className="card"
                style={{
                  ...S.workspaceCard,
                  borderLeftColor: strColor(p.id),
                  animationDelay: `${i * 0.03}s`
                }}
                onClick={() => navigate(`/project/${p.id}`)}
              >
                <div style={S.cardHeader}>
                  <div style={{ ...S.projectAvatar, background: `${strColor(p.id)}15`, color: strColor(p.id) }}>
                    {p.name[0].toUpperCase()}
                  </div>
                  <span className="tag tag-teal" style={S.modelBadge}>{shortModel(p.my_model)}</span>
                </div>
                <div style={S.cardBody}>
                  <h3 style={S.projectName}>{p.name}</h3>
                  {p.description ? (
                    <p style={S.projectDesc}>{p.description}</p>
                  ) : (
                    <p style={S.projectDescEmpty}>No description</p>
                  )}
                </div>
                <div style={S.cardFooter}>
                  <div style={S.memberCount}>
                    <Users size={12} />
                    <span>{p.member_count}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button
                      style={S.inviteCode}
                      onClick={e => {
                        e.stopPropagation()
                        navigator.clipboard.writeText(p.invite_code)
                        setCopied(p.invite_code)
                        setTimeout(() => setCopied(null), 2000)
                      }}
                    >
                      {copied === p.invite_code ? (
                        <Check size={11} color="var(--green)" />
                      ) : (
                        <Copy size={11} />
                      )}
                      <span style={S.inviteText}>{p.invite_code}</span>
                    </button>
                    {p.owner_id === user?.id && (
                      <button
                        title="Delete project"
                        onClick={e => {
                          e.stopPropagation()
                          setDeleteTarget({ id: p.id, name: p.name })
                          setDeleteInput('')
                        }}
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          color: 'var(--text-dim)', padding: '4px 6px', borderRadius: 4,
                          display: 'flex', alignItems: 'center',
                          fontSize: 12, transition: 'color 0.15s',
                        }}
                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--red, #f87171)'}
                        onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-dim)'}
                      >
                        🗑
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Active Forums Section */}
        {forums.length > 0 && (
          <section style={S.forumSection}>
            <div style={S.forumHeader}>
              <div style={S.forumTitle}>
                <Globe size={16} color="var(--teal)" />
                <span>Active Forums</span>
                {liveCount > 0 && (
                  <span style={S.liveBadge}>
                    <span className="live-dot" style={S.liveDot} />
                    {liveCount} LIVE
                  </span>
                )}
              </div>
              <button className="btn btn-ghost" style={S.viewAllBtn} onClick={() => navigate('/forum')}>
                View all
                <ChevronRight size={14} />
              </button>
            </div>
            <div style={S.forumGrid}>
              {forums.slice(0, 4).map(f => {
                const color = strColor(f.id)
                const live = isLive(f.last_activity)
                return (
                  <div
                    key={f.id}
                    className="card"
                    style={S.forumCard}
                    onClick={() => navigate(`/forum/${f.id}`)}
                  >
                    <div style={S.forumCardHeader}>
                      <div style={{ ...S.forumAvatar, background: `${color}15`, color, borderColor: `${color}30` }}>
                        {f.name[0].toUpperCase()}
                      </div>
                      {live && (
                        <span style={S.forumLive}>
                          <span className="live-dot" style={S.forumLiveDot} />
                          LIVE
                        </span>
                      )}
                    </div>
                    <div style={S.forumCardBody}>
                      <h4 style={S.forumName}>{f.name}</h4>
                      <p style={S.forumDesc}>{f.description || `by ${f.owner_name}`}</p>
                    </div>
                    <div style={S.forumStats}>
                      <span style={S.stat} title="Members">
                        <Users size={11} />
                        {f.member_count}
                      </span>
                      <span style={S.stat} title="Viewers">
                        <Eye size={11} />
                        {f.viewer_count}
                      </span>
                      <span style={S.stat} title="Messages">
                        <MessageSquare size={11} />
                        {f.message_count}
                      </span>
                      <span style={S.stat} title="Agents">
                        <Bot size={11} />
                        {f.agent_count}
                      </span>
                      {f.last_activity && (
                        <span style={S.forumTime}>{timeAgo(f.last_activity)}</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )}
      </main>

      {/* ── Modals ──────────────────────────────────────────────────── */}
      {(showCreate || showJoin) && (
        <div style={S.modalOverlay} onClick={() => { setShowCreate(false); setShowJoin(false) }}>
          <div className="card modal-animate" style={S.modal} onClick={e => e.stopPropagation()}>
            <div style={S.modalHeader}>
              <div style={S.modalIcon}>
                {showCreate ? <Plus size={18} color="var(--teal)" /> : <Hash size={18} color="var(--teal)" />}
              </div>
              <h2 style={S.modalTitle}>
                {showCreate ? 'New Workspace' : 'Join Workspace'}
              </h2>
            </div>
            <form onSubmit={showCreate ? createProject : joinProject} style={S.modalForm}>
              {showCreate ? (
                <>
                  <div style={S.formGroup}>
                    <label style={S.label}>Workspace Name</label>
                    <input
                      className="input"
                      style={S.input}
                      placeholder="e.g. Dragon v2"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      required
                      autoFocus
                    />
                  </div>
                  <div style={S.formGroup}>
                    <label style={S.label}>
                      Description <span style={S.labelOptional}>(optional)</span>
                    </label>
                    <input
                      className="input"
                      style={S.input}
                      placeholder="What are you building?"
                      value={desc}
                      onChange={e => setDesc(e.target.value)}
                    />
                  </div>
                </>
              ) : (
                <div style={S.formGroup}>
                  <label style={S.label}>Invite Code</label>
                  <input
                    className="input"
                    style={{ ...S.input, fontFamily: 'var(--mono)', letterSpacing: '0.05em' }}
                    placeholder="Paste code"
                    value={code}
                    onChange={e => setCode(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
              )}
              <div style={S.modalActions}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={S.cancelBtn}
                  onClick={() => { setShowCreate(false); setShowJoin(false) }}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  style={S.submitBtn}
                  disabled={loading}
                >
                  {loading ? 'Loading...' : showCreate ? 'Create' : 'Join'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Delete Confirmation Modal ──────────────────────────────── */}
      {deleteTarget && (
        <div
          style={S.modalOverlay}
          onClick={() => { setDeleteTarget(null); setDeleteInput('') }}
        >
          <div
            className="card modal-animate"
            style={{ width: '100%', maxWidth: 420, padding: 28, display: 'flex', flexDirection: 'column' as const, gap: 16 }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 38, height: 38, borderRadius: 10,
                background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                fontSize: 18,
              }}>🗑️</div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>Delete Project</h2>
            </div>

            {/* Warning */}
            <div style={{
              background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)',
              borderRadius: 8, padding: '12px 14px', fontSize: 13, color: '#f87171', lineHeight: 1.55,
            }}>
              ⚠️ This will permanently delete <strong>"{deleteTarget.name}"</strong> and all
              its files, messages, and history. This cannot be undone.
            </div>

            {/* Confirmation input */}
            <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
              <label style={{ fontSize: 12, color: 'var(--text-dim)', fontFamily: 'var(--mono)' }}>
                Type <strong style={{ color: 'var(--text)' }}>{deleteTarget.name}</strong> to confirm:
              </label>
              <input
                autoFocus
                value={deleteInput}
                onChange={e => setDeleteInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && deleteInput.trim() === deleteTarget.name) handleDeleteProject()
                  if (e.key === 'Escape') { setDeleteTarget(null); setDeleteInput('') }
                }}
                placeholder={deleteTarget.name}
                style={{
                  background: 'var(--bg3)', border: `1px solid ${deleteInput === deleteTarget.name ? '#f87171' : 'var(--border)'}`,
                  borderRadius: 6, padding: '8px 12px', color: 'var(--text)',
                  fontSize: 13, fontFamily: 'var(--font-mono, monospace)', outline: 'none',
                  transition: 'border-color 0.2s',
                }}
              />
            </div>

            {/* Buttons */}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                className="btn btn-ghost"
                onClick={() => { setDeleteTarget(null); setDeleteInput('') }}
                style={{ fontSize: 12 }}
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteProject}
                disabled={deleteInput.trim() !== deleteTarget.name || deleteLoading}
                style={{
                  background: deleteInput.trim() === deleteTarget.name ? '#ef4444' : 'var(--bg3)',
                  color: deleteInput.trim() === deleteTarget.name ? 'white' : 'var(--text-dim)',
                  border: 'none', borderRadius: 6, padding: '8px 18px',
                  cursor: deleteInput.trim() === deleteTarget.name ? 'pointer' : 'not-allowed',
                  fontWeight: 600, fontSize: 13, transition: 'all 0.2s',
                  fontFamily: 'var(--font, inherit)',
                }}
              >
                {deleteLoading ? 'Deleting...' : 'Delete Project'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  root: { display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--bg)' },

  // Sidebar
  sidebar: {
    width: 220,
    background: 'var(--bg1)',
    borderRight: '1px solid var(--border)',
    display: 'flex',
    flexDirection: 'column',
    padding: '12px 0',
    flexShrink: 0
  },
  logoWrap: {
    width: 44,
    height: 44,
    margin: '0 auto 8px',
    borderRadius: 10,
    background: 'linear-gradient(135deg, var(--teal), #20c5ad)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    boxShadow: '0 0 20px rgba(45, 212, 191, 0.2)'
  },
  nav: { display: 'flex', flexDirection: 'column', gap: 2, padding: '0 8px' },
  navItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 10px',
    background: 'transparent',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    color: 'var(--text-muted)',
    fontFamily: 'var(--font)',
    fontSize: 13,
    fontWeight: 500,
    transition: 'all 0.15s ease',
    textAlign: 'left'
  },

  // User section
  userSection: {
    padding: '12px',
    borderTop: '1px solid var(--border)',
    marginTop: 'auto'
  },
  userRow: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    fontWeight: 700,
    color: '#fff',
    flexShrink: 0,
    cursor: 'pointer',
    transition: 'transform 0.15s'
  },
  userInfo: { flex: 1, minWidth: 0, overflow: 'hidden' },
  userName: {
    fontSize: 13,
    fontWeight: 600,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  userUid: {
    fontSize: 10,
    color: 'var(--text-dim)',
    fontFamily: 'var(--mono)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  userActions: { display: 'flex', gap: 4 },
  actionBtn: {
    background: 'transparent',
    border: 'none',
    color: 'var(--text-dim)',
    cursor: 'pointer',
    padding: 6,
    borderRadius: 6,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.15s'
  },

  // Main content
  main: { flex: 1, overflow: 'auto', padding: '24px 32px', display: 'flex', flexDirection: 'column', gap: 20 },

  // Header
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' },
  headerTitle: { display: 'flex', alignItems: 'center', gap: 10 },
  heading: { fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 },
  badge: {
    fontSize: 11,
    color: 'var(--text-muted)',
    fontFamily: 'var(--mono)',
    background: 'var(--bg2)',
    padding: '3px 8px',
    borderRadius: 20,
    border: '1px solid var(--border)',
    fontWeight: 600
  },
  subheading: { color: 'var(--text-muted)', fontSize: 13, marginTop: 6, margin: 0 },

  headerActions: { display: 'flex', alignItems: 'center', gap: 8 },
  themeToggle: {
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    width: 36,
    height: 36,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    color: 'var(--text-muted)',
    transition: 'all 0.15s'
  },
  ghostBtn: { fontSize: 12, padding: '7px 12px' },
  primaryBtn: { fontSize: 12, padding: '7px 14px' },

  // Search bar
  searchBar: { marginBottom: 8 },
  searchInput: {
    display: 'flex',
    alignItems: 'center',
    background: 'var(--bg1)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '0 12px',
    height: 38
  },
  searchIcon: { color: 'var(--text-dim)', marginRight: 8, flexShrink: 0 },
  searchField: {
    flex: 1,
    border: 'none',
    background: 'transparent',
    fontSize: 13,
    outline: 'none',
    padding: 0,
    color: 'var(--text)'
  },

  // Workspace grid
  workspaceGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: 12
  },
  workspaceCard: {
    cursor: 'pointer',
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    animation: 'fadeUp 0.3s ease-out forwards',
    opacity: 0,
    transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
    borderLeftWidth: 3,
    borderLeftStyle: 'solid'
  },
  cardHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  projectAvatar: {
    width: 36,
    height: 36,
    borderRadius: 9,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 15,
    fontWeight: 800,
    flexShrink: 0
  },
  modelBadge: { fontSize: 9 },
  cardBody: { display: 'flex', flexDirection: 'column', gap: 6 },
  projectName: {
    fontSize: 14,
    fontWeight: 600,
    letterSpacing: '-0.01em',
    margin: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  projectDesc: {
    fontSize: 12,
    color: 'var(--text-muted)',
    margin: 0,
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden'
  },
  projectDescEmpty: {
    fontSize: 12,
    color: 'var(--text-dim)',
    margin: 0,
    fontStyle: 'italic'
  },
  cardFooter: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto' },
  memberCount: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    fontSize: 11,
    color: 'var(--text-muted)'
  },
  inviteCode: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: '4px 8px',
    cursor: 'pointer',
    transition: 'all 0.15s'
  },
  inviteText: { fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-muted)' },

  // Empty state
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '64px 24px',
    textAlign: 'center'
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 16,
    background: 'var(--bg1)',
    border: '1px solid var(--border)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    boxShadow: 'var(--shadow-glow)'
  },
  emptyHeading: { fontSize: 18, fontWeight: 700, margin: '0 0 8px' },
  emptyText: { fontSize: 13, color: 'var(--text-muted)', margin: '0 0 20px' },
  emptyBtn: { fontSize: 13, padding: '9px 18px' },

  // Forum section
  forumSection: {
    background: 'var(--bg1)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: '18px 20px'
  },
  forumHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  forumTitle: { display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, fontWeight: 600 },
  liveBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    background: 'var(--green-dim)',
    border: '1px solid rgba(52, 211, 153, 0.15)',
    borderRadius: 20,
    padding: '3px 8px',
    fontSize: 10,
    color: 'var(--green)',
    fontFamily: 'var(--mono)',
    fontWeight: 700
  },
  liveDot: { width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', display: 'inline-block' },
  viewAllBtn: { fontSize: 11, padding: '5px 10px' },

  forumGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
    gap: 12
  },
  forumCard: {
    cursor: 'pointer',
    padding: 14,
    transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)'
  },
  forumCardHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  forumAvatar: {
    width: 36,
    height: 36,
    borderRadius: 10,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 14,
    fontWeight: 800,
    borderWidth: 1,
    borderStyle: 'solid',
    flexShrink: 0
  },
  forumLive: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    background: 'var(--green-dim)',
    padding: '3px 7px',
    borderRadius: 20,
    fontSize: 9,
    color: 'var(--green)',
    fontFamily: 'var(--mono)',
    fontWeight: 700
  },
  forumLiveDot: { width: 5, height: 5, borderRadius: '50%', background: 'var(--green)', display: 'inline-block' },
  forumCardBody: { marginBottom: 12 },
  forumName: { fontSize: 13, fontWeight: 600, margin: '0 0 4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  forumDesc: { fontSize: 11, color: 'var(--text-dim)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  forumStats: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    borderTop: '1px solid var(--border)',
    paddingTop: 10
  },
  stat: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text-muted)' },
  forumTime: { marginLeft: 'auto', fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--mono)' },

  // Modal
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0, 0, 0, 0.7)',
    backdropFilter: 'blur(8px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100
  },
  modal: { width: '100%', maxWidth: 440, padding: 24 },
  modalHeader: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 },
  modalIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    background: 'var(--teal-dim)',
    border: '1px solid rgba(45, 212, 191, 0.15)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0
  },
  modalTitle: { fontSize: 18, fontWeight: 700, margin: 0 },
  modalForm: { display: 'flex', flexDirection: 'column', gap: 16 },
  formGroup: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: {
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    fontFamily: 'var(--mono)'
  },
  labelOptional: { color: 'var(--text-dim)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 },
  input: { padding: '10px 12px', fontSize: 13 },
  modalActions: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 },
  cancelBtn: { fontSize: 12 },
  submitBtn: { fontSize: 12, padding: '8px 16px' }
}
