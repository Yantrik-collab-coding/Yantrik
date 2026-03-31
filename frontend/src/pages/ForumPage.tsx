import React, { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Globe, Search, Users, Eye, MessageSquare, Bot,
  Plus, Tag, Clock, ArrowRight, Zap, Lock, Send
} from 'lucide-react'
import api from '../lib/api'
import { useAuthStore } from '../lib/store'

interface PublicProject {
  id: string; name: string; description: string; tags: string
  owner_name: string; owner_color: string
  member_count: number; viewer_count: number
  message_count: number; agent_count: number
  last_activity: string | null
}

interface JoinRequest {
  id: string; user_id: string; username: string
  avatar_color: string; message: string; created_at: string
}

const TAG_COLORS: Record<string, string> = {
  python: 'tag-amber', saas: 'tag-blue', ml: 'tag-purple',
  ai: 'tag-purple', react: 'tag-blue', fastapi: 'tag-green',
  hackathon: 'tag-amber', open: 'tag-green', default: 'tag-blue',
}

function tagColor(tag: string) { return TAG_COLORS[tag.toLowerCase()] || TAG_COLORS.default }

function timeAgo(ts: string | null) {
  if (!ts) return 'No activity'
  const diff = Date.now() - new Date(ts).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'Just now'; if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function ForumPage() {
  const { user } = useAuthStore()
  const navigate  = useNavigate()
  const [projects, setProjects]     = useState<PublicProject[]>([])
  const [search, setSearch]         = useState('')
  const [activeTag, setActiveTag]   = useState('')
  const [loading, setLoading]       = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [cName, setCName]   = useState('')
  const [cDesc, setCDesc]   = useState('')
  const [cTags, setCTags]   = useState('')
  const [cLoading, setCLoading] = useState(false)

  useEffect(() => {
    load()
    const interval = setInterval(load, 10000)
    return () => clearInterval(interval)
  }, [search, activeTag])

  async function load() {
    try {
      const params = new URLSearchParams()
      if (search)    params.set('search', search)
      if (activeTag) params.set('tag', activeTag)
      const { data } = await api.get(`/forum/?${params}`)
      setProjects(data)
    } finally { setLoading(false) }
  }

  async function createPublic(e: React.FormEvent) {
    e.preventDefault(); setCLoading(true)
    try {
      const { data } = await api.post('/forum/create', { name: cName, description: cDesc, tags: cTags })
      setShowCreate(false); setCName(''); setCDesc(''); setCTags('')
      navigate(`/forum/${data.id}`)
    } finally { setCLoading(false) }
  }

  const allTags = Array.from(new Set(
    projects.flatMap(p => p.tags ? p.tags.split(',').map(t => t.trim()).filter(Boolean) : [])
  )).slice(0, 12)

  return (
    <div style={S.root}>
      <div style={S.header}>
        <div style={S.headerLeft}>
          <button style={S.backBtn} onClick={() => navigate('/')}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-dim)'}>
            ← Dashboard
          </button>
          <div style={S.titleRow}>
            <Globe size={20} color="var(--blue)" />
            <h1 style={S.title}>Open Forum</h1>
            <span style={S.liveChip}><span style={S.liveDot} />LIVE</span>
          </div>
          <p style={S.subtitle}>Public AI workspaces — watch, browse, request to collaborate</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
          <Plus size={14} /> New Public Project
        </button>
      </div>

      <div style={S.filterBar}>
        <div style={S.searchWrap}>
          <Search size={13} color="var(--text-dim)" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
          <input className="input" style={{ paddingLeft: 34 }} placeholder="Search projects..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div style={S.tags}>
          <button style={{ ...S.tagBtn, ...(activeTag === '' ? S.tagBtnActive : {}) }} onClick={() => setActiveTag('')}>All</button>
          {allTags.map(tag => (
            <button key={tag} style={{ ...S.tagBtn, ...(activeTag === tag ? S.tagBtnActive : {}) }}
              onClick={() => setActiveTag(activeTag === tag ? '' : tag)}>#{tag}</button>
          ))}
        </div>
      </div>

      <div style={S.grid}>
        {loading && <div style={S.empty}>Loading...</div>}
        {!loading && projects.length === 0 && (
          <div style={S.empty}>
            <Globe size={36} color="var(--text-dim)" />
            <p style={{ fontWeight: 600 }}>No public projects yet.</p>
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>Create the first one</button>
          </div>
        )}
        {projects.map(p => (
          <ProjectCard key={p.id} project={p} onClick={() => navigate(`/forum/${p.id}`)} />
        ))}
      </div>

      {showCreate && (
        <div style={S.overlay} onClick={() => setShowCreate(false)}>
          <div className="card" style={S.modal} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
              <Globe size={17} color="var(--blue)" />
              <h2 style={{ fontSize: 17, fontWeight: 700 }}>New Public Project</h2>
            </div>
            <form onSubmit={createPublic} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={S.label}>Project Name</label>
                <input className="input" placeholder="e.g. Build a SaaS in 24hrs" value={cName} onChange={e => setCName(e.target.value)} required />
              </div>
              <div>
                <label style={S.label}>Description</label>
                <textarea className="input" placeholder="What are you building? Anyone can see this." value={cDesc} onChange={e => setCDesc(e.target.value)} rows={3} style={{ resize: 'none' }} />
              </div>
              <div>
                <label style={S.label}>Tags <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>(comma separated)</span></label>
                <input className="input" placeholder="python, saas, ml, hackathon" value={cTags} onChange={e => setCTags(e.target.value)} />
              </div>
              <div style={{ background: 'var(--blue-dim)', border: '1px solid rgba(96,165,250,0.12)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                🌐 Anyone can <strong>read and watch</strong> this project. They must <strong>request permission</strong> to write in chat or invoke agents.
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
                <button className="btn btn-primary" disabled={cLoading}>{cLoading ? 'Creating...' : 'Create Public Project'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

function ProjectCard({ project: p, onClick }: { project: PublicProject; onClick: () => void }) {
  const isActive = p.last_activity && (Date.now() - new Date(p.last_activity).getTime()) < 5 * 60 * 1000
  return (
    <div style={S.card} onClick={onClick} className="forum-card">
      <div style={S.cardTop}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ ...S.projectIcon, background: p.owner_color + '18', color: p.owner_color }}>
            {p.name[0].toUpperCase()}
          </div>
          <div>
            <div style={S.projectName}>{p.name}</div>
            <div style={S.ownerName}>by {p.owner_name}</div>
          </div>
        </div>
        {isActive && (
          <div style={S.activeChip}>
            <span style={{ ...S.liveDot, background: 'var(--green)' }} />LIVE
          </div>
        )}
      </div>
      {p.description && <p style={S.desc}>{p.description}</p>}
      {p.tags && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {p.tags.split(',').map(t => t.trim()).filter(Boolean).map(tag => (
            <span key={tag} className={`tag ${tagColor(tag)}`}>#{tag}</span>
          ))}
        </div>
      )}
      <div style={S.cardStats}>
        <span style={S.stat}><Users size={11} /> {p.member_count}</span>
        <span style={S.stat}><Eye size={11} /> {p.viewer_count}</span>
        <span style={S.stat}><MessageSquare size={11} /> {p.message_count}</span>
        <span style={S.stat}><Bot size={11} /> {p.agent_count}</span>
        <span style={{ ...S.stat, marginLeft: 'auto', color: 'var(--text-dim)' }}>
          <Clock size={10} /> {timeAgo(p.last_activity)}
        </span>
      </div>
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  root: { minHeight: '100vh', background: 'var(--bg)', padding: '28px 36px' },
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 },
  headerLeft: { display: 'flex', flexDirection: 'column', gap: 6 },
  backBtn: { background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 12, fontFamily: 'var(--mono)', textAlign: 'left', padding: 0, marginBottom: 4, transition: 'color 0.15s' },
  titleRow: { display: 'flex', alignItems: 'center', gap: 10 },
  title: { fontSize: 26, fontWeight: 800, letterSpacing: '-0.03em' },
  liveChip: { display: 'flex', alignItems: 'center', gap: 5, background: 'var(--green-dim)', border: '1px solid rgba(52,211,153,0.12)', borderRadius: 20, padding: '3px 10px', fontSize: 9, fontWeight: 700, color: 'var(--green)', fontFamily: 'var(--mono)' },
  liveDot: { width: 5, height: 5, borderRadius: '50%', background: 'var(--green)', display: 'inline-block', animation: 'pulse 2s infinite' },
  subtitle: { color: 'var(--text-muted)', fontSize: 13 },
  filterBar: { display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 },
  searchWrap: { position: 'relative', maxWidth: 380 },
  tags: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  tagBtn: { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 20, padding: '4px 12px', fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'var(--font)', transition: 'all 0.15s' },
  tagBtnActive: { background: 'var(--blue-dim)', borderColor: 'rgba(96,165,250,0.2)', color: 'var(--blue)' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 },
  empty: { gridColumn: '1/-1', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: 64, color: 'var(--text-dim)' },
  card: {
    background: 'var(--bg1)', border: '1px solid var(--border)', borderRadius: 12,
    padding: 18, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 10,
  },
  cardTop: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' },
  projectIcon: { width: 36, height: 36, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 800, flexShrink: 0 },
  projectName: { fontWeight: 700, fontSize: 14, letterSpacing: '-0.01em' },
  ownerName: { fontSize: 11, color: 'var(--text-muted)', marginTop: 1 },
  activeChip: { display: 'flex', alignItems: 'center', gap: 4, background: 'var(--green-dim)', border: '1px solid rgba(52,211,153,0.12)', borderRadius: 20, padding: '3px 8px', fontSize: 9, fontWeight: 700, color: 'var(--green)', fontFamily: 'var(--mono)', flexShrink: 0 },
  desc: { fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } as any,
  cardStats: { display: 'flex', alignItems: 'center', gap: 12, borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 2 },
  stat: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-muted)' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(12px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, animation: 'fadeIn 0.15s ease-out' },
  modal: { width: '100%', maxWidth: 480, padding: 28, animation: 'scaleIn 0.2s ease-out' },
  label: { display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'var(--mono)', marginBottom: 6 },
}
