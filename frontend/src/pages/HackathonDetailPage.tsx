import React, { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Trophy, Users, Plus, Eye, ArrowRight, Check, X, Crown, UserPlus, Code } from 'lucide-react'
import api from '../lib/api'
import { useAuthStore } from '../lib/store'

interface Member { id: string; username: string; avatar_color: string; uid: string; role: string }
interface Team { id: string; name: string; leader_name: string; leader_color: string; project_id: string; members: Member[] }
interface Judge { id: string; username: string; avatar_color: string; uid: string }
interface Hackathon {
  id: string; name: string; description: string; status: string
  max_teams: number; max_per_team: number; start_time: string | null; end_time: string | null
  organizer_name: string; organizer_color: string
  judges: Judge[]; teams: Team[]
  is_organizer: boolean; is_judge: boolean; my_team: any
}
interface TeamOverview {
  team_id: string; team_name: string; leader_name: string; leader_color: string
  recent_messages: any[]; files: any[]
  project_id?: string
}

export default function HackathonDetailPage() {
  const { id }   = useParams<{ id: string }>()
  const navigate  = useNavigate()
  const { user }  = useAuthStore()
  const [h, setH]             = useState<Hackathon | null>(null)
  const [teams, setTeams]     = useState<Team[]>([])
  const [overview, setOverview] = useState<TeamOverview[]>([])
  const [tab, setTab]         = useState<'teams' | 'judge'>('teams')
  const [showJudge, setShowJudge] = useState(false)

  // Team creation
  const [showCreateTeam, setShowCreateTeam] = useState(false)
  const [teamName, setTeamName]             = useState('')
  const [teamLoading, setTeamLoading]       = useState(false)

  // Invite member
  const [inviteUid, setInviteUid]   = useState('')
  const [inviteTid, setInviteTid]   = useState('')
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteResult, setInviteResult]   = useState('')

  // Add judge
  const [judgeUid, setJudgeUid]   = useState('')
  const [judgeLoading, setJudgeLoading] = useState(false)

  useEffect(() => { if (id) loadAll() }, [id])

  async function loadAll() {
    const { data } = await api.get(`/hackathons/${id}`)
    setH(data)
    const { data: t } = await api.get(`/hackathons/${id}/teams`)
    setTeams(t)
  }

  async function loadOverview() {
    const { data } = await api.get(`/hackathons/${id}/judge/overview`)
    setOverview(data)
  }

  async function createTeam(e: React.FormEvent) {
    e.preventDefault(); setTeamLoading(true)
    try {
      const { data } = await api.post(`/hackathons/${id}/teams`, { name: teamName })
      setShowCreateTeam(false); setTeamName('')
      await loadAll()
      navigate(`/project/${data.project_id}`)
    } catch (err: any) { alert(err.response?.data?.detail || 'Failed') }
    finally { setTeamLoading(false) }
  }

  async function inviteMember(tid: string) {
    if (!inviteUid.trim()) return
    setInviteLoading(true); setInviteResult('')
    try {
      await api.post(`/hackathons/${id}/teams/${tid}/invite/${inviteUid.trim().toUpperCase()}`)
      setInviteResult('✓ Invited!'); setInviteUid('')
      setTimeout(() => setInviteResult(''), 2000)
      await loadAll()
    } catch (err: any) { setInviteResult(err.response?.data?.detail || 'Failed') }
    finally { setInviteLoading(false) }
  }

  async function addJudge() {
    if (!judgeUid.trim()) return
    setJudgeLoading(true)
    try {
      await api.post(`/hackathons/${id}/judges/${judgeUid.trim().toUpperCase()}`)
      setJudgeUid(''); await loadAll()
    } catch (err: any) { alert(err.response?.data?.detail || 'Failed') }
    finally { setJudgeLoading(false) }
  }

  async function updateStatus(status: string) {
    await api.patch(`/hackathons/${id}/status`, { status })
    await loadAll()
  }

  async function acceptInvite(tid: string) {
    await api.post(`/hackathons/${id}/teams/${tid}/accept`)
    await loadAll()
  }

  const myPendingInvite = teams.find(t =>
    t.members.some(m => m.id === user?.id && m.role === 'invited')
  )

  if (!h) return <div style={{ padding: 40, color: 'var(--text-muted)' }}>Loading...</div>

  return (
    <div style={S.root}>
      <div style={S.bg} />
      <div style={S.inner}>
        <button style={S.back} onClick={() => navigate('/hackathon')}>← Hackathons</button>

        {/* Header */}
        <div style={S.header}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
            <div style={{ ...S.icon, background: h.organizer_color + '33', color: h.organizer_color }}>
              <Trophy size={20} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <h1 style={S.title}>{h.name}</h1>
                <span className={`tag ${h.status === 'active' ? 'tag-green' : h.status === 'ended' ? 'tag-amber' : 'tag-blue'}`}>{h.status}</span>
              </div>
              {h.description && <p style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: 4 }}>{h.description}</p>}
              <div style={{ display: 'flex', gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
                <span style={S.meta}>Organized by {h.organizer_name}</span>
                <span style={S.meta}>{teams.length}/{h.max_teams} teams · {h.max_per_team} members/team</span>
                {h.start_time && <span style={S.meta}>Starts: {new Date(h.start_time).toLocaleString()}</span>}
                {h.end_time   && <span style={S.meta}>Ends: {new Date(h.end_time).toLocaleString()}</span>}
              </div>
            </div>
          </div>

          {h.is_organizer && (
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              {h.status === 'upcoming' && <button className="btn btn-primary" onClick={() => updateStatus('active')}>▶ Start</button>}
              {h.status === 'active'   && <button className="btn btn-ghost"   onClick={() => updateStatus('ended')}>⏹ End</button>}
            </div>
          )}
        </div>

        {/* Pending invite banner */}
        {myPendingInvite && (
          <div style={S.inviteBanner}>
            <span>🎉 You've been invited to join team <strong>{myPendingInvite.name}</strong></span>
            <button className="btn btn-primary" style={{ padding: '6px 14px', fontSize: 12 }} onClick={() => acceptInvite(myPendingInvite.id)}>
              Accept Invite
            </button>
          </div>
        )}

        {/* Tabs */}
        <div style={S.tabs}>
          <button style={{ ...S.tab, ...(tab === 'teams' ? S.tabActive : {}) }} onClick={() => setTab('teams')}>
            <Users size={14} /> Teams ({teams.length})
          </button>
          {(h.is_judge || h.is_organizer) && (
            <button style={{ ...S.tab, ...(tab === 'judge' ? S.tabActive : {}) }}
              onClick={() => { setTab('judge'); loadOverview() }}>
              <Eye size={14} /> Judge View
            </button>
          )}
        </div>

        {/* Teams tab */}
        {tab === 'teams' && (
          <div>
            {/* Judges */}
            <div style={S.judgesRow}>
              <span style={S.sectionTitle}>⚖️ Judges</span>
              {h.judges.map(j => (
                <div key={j.id} style={S.judgeChip}>
                  <div style={{ ...S.avatar, background: j.avatar_color, width: 20, height: 20, fontSize: 10 }}>{j.username[0].toUpperCase()}</div>
                  {j.username}
                </div>
              ))}
              {h.is_organizer && (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 8 }}>
                  <input className="input" style={{ width: 120, padding: '4px 8px', fontSize: 12 }}
                    placeholder="UID" value={judgeUid} onChange={e => setJudgeUid(e.target.value)} />
                  <button className="btn btn-ghost" style={{ padding: '5px 10px', fontSize: 12 }} onClick={addJudge} disabled={judgeLoading}>
                    + Add Judge
                  </button>
                </div>
              )}
            </div>

            {/* Register team button */}
            {!h.my_team && user && h.status !== 'ended' && (
              <div style={{ marginBottom: 20 }}>
                <button className="btn btn-primary" onClick={() => setShowCreateTeam(true)}>
                  <Plus size={14} /> Register Your Team
                </button>
              </div>
            )}

            {h.my_team && (
              <div style={{ marginBottom: 16, padding: '10px 14px', background: 'var(--accent-dim)', border: '1px solid var(--accent)33', borderRadius: 8, fontSize: 13, display: 'flex', alignItems: 'center', gap: 10 }}>
                ✓ You're in team <strong>{teams.find(t => t.id === h.my_team.id)?.name}</strong>
                <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 12, marginLeft: 'auto' }}
                  onClick={() => navigate(`/project/${h.my_team.project_id}`)}>
                  Open Workspace <ArrowRight size={12} />
                </button>
              </div>
            )}

            {/* Team cards */}
            <div style={S.grid}>
              {teams.map(team => {
                const isMyTeam = h.my_team?.id === team.id
                const amLeader = team.members.find(m => m.id === user?.id && m.role === 'leader')
                return (
                  <div key={team.id} className="card" style={{ ...S.teamCard, ...(isMyTeam ? S.myTeam : {}) }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Crown size={14} color={team.leader_color} />
                        <span style={{ fontWeight: 700, fontSize: 15 }}>{team.name}</span>
                        {isMyTeam && <span className="tag tag-amber" style={{ fontSize: 10 }}>your team</span>}
                      </div>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{team.members.length}/{h.max_per_team}</span>
                    </div>

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {team.members.map(m => (
                        <div key={m.id} style={S.memberChip}>
                          <div style={{ ...S.avatar, background: m.avatar_color, width: 22, height: 22, fontSize: 10 }}>{m.username[0].toUpperCase()}</div>
                          <span style={{ fontSize: 12 }}>{m.username}</span>
                          {m.role === 'leader' && <Crown size={10} color="var(--accent)" />}
                          {m.role === 'invited' && <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>(invited)</span>}
                        </div>
                      ))}
                    </div>

                    {/* Leader: invite by UID */}
                    {amLeader && team.members.length < h.max_per_team && (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <input className="input" style={{ fontSize: 12, padding: '6px 10px' }}
                          placeholder="Invite by UID (e.g. AB12CD34)"
                          value={inviteTid === team.id ? inviteUid : ''}
                          onChange={e => { setInviteUid(e.target.value); setInviteTid(team.id) }}
                        />
                        <button className="btn btn-primary" style={{ padding: '6px 12px', fontSize: 12 }}
                          onClick={() => inviteMember(team.id)} disabled={inviteLoading}>
                          <UserPlus size={13} />
                        </button>
                      </div>
                    )}
                    {inviteTid === team.id && inviteResult && (
                      <span style={{ fontSize: 12, color: inviteResult.startsWith('✓') ? 'var(--green)' : 'var(--red)', fontFamily: 'var(--font-mono)' }}>
                        {inviteResult}
                      </span>
                    )}

                    {isMyTeam && team.project_id && (
                      <button className="btn btn-ghost" style={{ justifyContent: 'center', fontSize: 13 }}
                        onClick={() => navigate(`/project/${team.project_id}`)}>
                        <Code size={13} /> Open Team Workspace
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Judge view tab */}
        {tab === 'judge' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              As a judge you can see all team workspaces. Teams cannot see each other.
            </p>
            {overview.map(t => (
              <div key={t.team_id} className="card" style={{ padding: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ ...S.avatar, background: t.leader_color }}>{t.leader_name[0].toUpperCase()}</div>
                    <div>
                      <div style={{ fontWeight: 700 }}>{t.team_name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>led by {t.leader_name}</div>
                    </div>
                  </div>
                  {t.project_id && (
                    <button className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 12px' }}
                      onClick={() => navigate(`/project/${t.project_id}`)}>
                      Full Workspace <ArrowRight size={12} />
                    </button>
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  {/* Files */}
                  <div>
                    <div style={S.sectionTitle}>📁 Files ({t.files.length})</div>
                    {t.files.length === 0 ? <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>No files yet</p> :
                      t.files.map(f => (
                        <div key={f.id} style={{ fontSize: 12, color: 'var(--text-muted)', padding: '3px 0', fontFamily: 'var(--font-mono)' }}>
                          {f.filename}
                        </div>
                      ))
                    }
                  </div>

                  {/* Recent chat */}
                  <div>
                    <div style={S.sectionTitle}>💬 Recent Activity ({t.recent_messages.length} msgs)</div>
                    <div style={{ maxHeight: 160, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {t.recent_messages.slice(-5).map((msg: any) => (
                        <div key={msg.id} style={{ fontSize: 12, lineHeight: 1.4 }}>
                          <span style={{ color: msg.is_agent ? 'var(--purple)' : 'var(--accent2)', fontWeight: 600 }}>
                            {msg.author_name}:
                          </span>{' '}
                          <span style={{ color: 'var(--text-muted)' }}>{msg.content.slice(0, 80)}{msg.content.length > 80 ? '...' : ''}</span>
                        </div>
                      ))}
                      {t.recent_messages.length === 0 && <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>No activity yet</p>}
                    </div>
                  </div>
                </div>
              </div>
            ))}
            {overview.length === 0 && <p style={{ color: 'var(--text-dim)', fontSize: 14 }}>No teams registered yet.</p>}
          </div>
        )}
      </div>

      {/* Create team modal */}
      {showCreateTeam && (
        <div style={S.overlay} onClick={() => setShowCreateTeam(false)}>
          <div className="card" style={S.modal} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>Register Your Team</h2>
            <form onSubmit={createTeam} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={S.label}>Team Name</label>
                <input className="input" placeholder="e.g. Team Phoenix" value={teamName} onChange={e => setTeamName(e.target.value)} required />
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                A private workspace will be created for your team. Invite members by their UID after registering.
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-ghost" onClick={() => setShowCreateTeam(false)}>Cancel</button>
                <button className="btn btn-primary" disabled={teamLoading}>{teamLoading ? 'Creating...' : 'Register Team'}</button>
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
  bg: { position: 'fixed', inset: 0, backgroundImage: 'radial-gradient(ellipse 70% 40% at 50% -10%, #f0a50010, transparent)', pointerEvents: 'none' },
  inner: { maxWidth: 1100, margin: '0 auto', padding: '40px' },
  back: { background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 13, fontFamily: 'var(--font-mono)', padding: 0, marginBottom: 24, display: 'block' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 },
  icon: { width: 48, height: 48, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  title: { fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em' },
  meta: { fontSize: 13, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' },
  inviteBanner: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'var(--accent2-dim)', border: '1px solid var(--accent2)44', borderRadius: 10, marginBottom: 20, fontSize: 14 },
  tabs: { display: 'flex', gap: 4, background: 'var(--bg1)', borderRadius: 10, padding: 4, marginBottom: 24, width: 'fit-content' },
  tab: { display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-display)', transition: 'all 0.15s' },
  tabActive: { background: 'var(--bg2)', color: 'var(--text)' },
  judgesRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20, flexWrap: 'wrap' },
  judgeChip: { display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 20, padding: '4px 10px', fontSize: 12 },
  sectionTitle: { fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'var(--font-mono)', marginBottom: 8 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 },
  teamCard: { display: 'flex', flexDirection: 'column', gap: 12 },
  myTeam: { borderColor: 'var(--accent)', background: 'var(--accent-dim)' },
  memberChip: { display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 20, padding: '3px 10px' },
  avatar: { width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#fff', flexShrink: 0 },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  modal: { width: '100%', maxWidth: 440, padding: 28 },
  label: { display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'var(--font-mono)', marginBottom: 6 },
}
