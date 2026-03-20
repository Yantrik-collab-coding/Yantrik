import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Trophy, Plus, Users, Clock, ArrowRight, Globe } from 'lucide-react'
import api from '../lib/api'
import { useAuthStore } from '../lib/store'

interface Hackathon {
  id: string; name: string; description: string; organizer_name: string
  organizer_color: string; max_teams: number; max_per_team: number
  team_count: number; status: string; start_time: string | null; end_time: string | null
  created_at: string
}

const STATUS_STYLES: Record<string, string> = {
  upcoming: 'tag-blue', active: 'tag-green', ended: 'tag-amber'
}

function formatDate(d: string | null) {
  if (!d) return 'TBD'
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function HackathonPage() {
  const { user }  = useAuthStore()
  const navigate  = useNavigate()
  const [hackathons, setHackathons] = useState<Hackathon[]>([])
  const [loading, setLoading]       = useState(true)
  const [showCreate, setShowCreate] = useState(false)

  // Create form
  const [name, setName]               = useState('')
  const [desc, setDesc]               = useState('')
  const [maxTeams, setMaxTeams]       = useState(8)
  const [maxPerTeam, setMaxPerTeam]   = useState(4)
  const [startTime, setStartTime]     = useState('')
  const [endTime, setEndTime]         = useState('')
  const [creating, setCreating]       = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    try {
      const { data } = await api.get('/hackathons/')
      setHackathons(data)
    } finally { setLoading(false) }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    try {
      const { data } = await api.post('/hackathons/', {
        name, description: desc, max_teams: maxTeams, max_per_team: maxPerTeam,
        start_time: startTime || null, end_time: endTime || null,
      })
      navigate(`/hackathon/${data.id}`)
    } finally { setCreating(false) }
  }

  return (
    <div style={S.root}>
      <div style={S.bg} />
      <div style={S.inner}>
        <button style={S.back} onClick={() => navigate('/')}>← Dashboard</button>

        <div style={S.header}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <Trophy size={26} color="var(--accent)" />
              <h1 style={S.title}>Hackathons</h1>
            </div>
            <p style={S.sub}>Organize or participate in coding competitions powered by AI</p>
          </div>
          {user && (
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
              <Plus size={15} /> Host Hackathon
            </button>
          )}
        </div>

        {loading && <p style={{ color: 'var(--text-dim)' }}>Loading...</p>}

        <div style={S.grid}>
          {hackathons.map(h => (
            <div key={h.id} className="card" style={S.card} onClick={() => navigate(`/hackathon/${h.id}`)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ ...S.icon, background: h.organizer_color + '33', color: h.organizer_color }}>
                    <Trophy size={16} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>{h.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>by {h.organizer_name}</div>
                  </div>
                </div>
                <span className={`tag ${STATUS_STYLES[h.status] || 'tag-blue'}`}>{h.status}</span>
              </div>

              {h.description && <p style={S.desc}>{h.description}</p>}

              <div style={S.stats}>
                <span style={S.stat}><Users size={12} /> {h.team_count}/{h.max_teams} teams</span>
                <span style={S.stat}><Users size={12} /> {h.max_per_team} per team</span>
                <span style={S.stat}><Clock size={12} /> {formatDate(h.start_time)}</span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <span style={{ fontSize: 12, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  View details <ArrowRight size={12} />
                </span>
              </div>
            </div>
          ))}
          {!loading && hackathons.length === 0 && (
            <div style={S.empty}>
              <Trophy size={40} color="var(--text-dim)" />
              <p>No hackathons yet. Host the first one!</p>
              {user && <button className="btn btn-primary" onClick={() => setShowCreate(true)}>Host Hackathon</button>}
            </div>
          )}
        </div>
      </div>

      {showCreate && (
        <div style={S.overlay} onClick={() => setShowCreate(false)}>
          <div className="card" style={S.modal} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
              <Trophy size={18} color="var(--accent)" />
              <h2 style={{ fontSize: 18, fontWeight: 700 }}>Host a Hackathon</h2>
            </div>
            <form onSubmit={create} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={S.label}>Hackathon Name</label>
                <input className="input" placeholder="e.g. HackIIT 2026" value={name} onChange={e => setName(e.target.value)} required />
              </div>
              <div>
                <label style={S.label}>Description</label>
                <textarea className="input" rows={3} style={{ resize: 'none' }} placeholder="What are participants building?" value={desc} onChange={e => setDesc(e.target.value)} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={S.label}>Max Teams</label>
                  <input className="input" type="number" min={2} max={100} value={maxTeams} onChange={e => setMaxTeams(+e.target.value)} />
                </div>
                <div>
                  <label style={S.label}>Members per Team</label>
                  <input className="input" type="number" min={1} max={10} value={maxPerTeam} onChange={e => setMaxPerTeam(+e.target.value)} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={S.label}>Start Time (optional)</label>
                  <input className="input" type="datetime-local" value={startTime} onChange={e => setStartTime(e.target.value)} />
                </div>
                <div>
                  <label style={S.label}>End Time (optional)</label>
                  <input className="input" type="datetime-local" value={endTime} onChange={e => setEndTime(e.target.value)} />
                </div>
              </div>
              <div style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent)33', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: 'var(--text-muted)' }}>
                🏆 You'll be the organizer and a judge. Each team gets an isolated private workspace. Add more judges by their UID after creation.
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
                <button className="btn btn-primary" disabled={creating}>{creating ? 'Creating...' : 'Create Hackathon'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  root: { minHeight: '100vh', background: 'var(--bg)', position: 'relative' },
  bg: { position: 'fixed', inset: 0, backgroundImage: 'radial-gradient(ellipse 70% 40% at 50% -10%, #f0a50012, transparent)', pointerEvents: 'none' },
  inner: { maxWidth: 1100, margin: '0 auto', padding: '48px 40px' },
  back: { background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 13, fontFamily: 'var(--font-mono)', padding: 0, marginBottom: 24, display: 'block' },
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 36 },
  title: { fontSize: 32, fontWeight: 800, letterSpacing: '-0.02em' },
  sub: { color: 'var(--text-muted)', fontSize: 14 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 },
  card: { cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 12, transition: 'border-color 0.15s, transform 0.15s' },
  icon: { width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  desc: { fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 },
  stats: { display: 'flex', gap: 16, flexWrap: 'wrap' },
  stat: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-muted)' },
  empty: { gridColumn: '1/-1', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: 80, color: 'var(--text-dim)' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  modal: { width: '100%', maxWidth: 560, padding: 28, maxHeight: '90vh', overflowY: 'auto' },
  label: { display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'var(--font-mono)', marginBottom: 6 },
}
