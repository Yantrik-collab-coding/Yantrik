import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus, LogOut, Users, Hash, Copy, Check, Settings,
  Globe, Trophy, HelpCircle, DollarSign, Eye,
  MessageSquare, Bot, ChevronRight, Search, Code2
} from 'lucide-react'
import api from '../lib/api'
import { useAuthStore } from '../lib/store'

interface Project {
  id: string; name: string; description: string
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
  const [projects, setProjects]       = useState<Project[]>([])
  const [forums,   setForums]         = useState<Forum[]>([])
  const [search,   setSearch]         = useState('')
  const [showCreate, setShowCreate]   = useState(false)
  const [showJoin,   setShowJoin]     = useState(false)
  const [name,     setName]           = useState('')
  const [desc,     setDesc]           = useState('')
  const [code,     setCode]           = useState('')
  const [loading,  setLoading]        = useState(false)
  const [copied,   setCopied]         = useState<string|null>(null)
  const [hoveredForum, setHoveredForum] = useState<string|null>(null)

  useEffect(() => {
    api.get('/projects/').then(r => setProjects(r.data)).catch(() => {})
    loadForums()
    const t = setInterval(loadForums, 12000)
    return () => clearInterval(t)
  }, [])

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

  return (
    <div style={S.root}>

      {/* ── Forum icon strip ─────────────────────────────────────── */}
      <div style={S.strip}>
        <div style={S.stripLogo} onClick={() => navigate('/')}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderRadius='50%'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderRadius='12px'}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <div style={S.stripDivider}/>

        {forums.slice(0,13).map(f => {
          const color = strColor(f.id)
          const live  = isLive(f.last_activity)
          const hovered = hoveredForum === f.id
          return (
            <div key={f.id} style={{position:'relative', display:'flex', alignItems:'center'}}>
              {/* Discord active pip */}
              <div style={{
                position:'absolute', left:-8, top:'50%', transform:'translateY(-50%)',
                width:4, background:'var(--text)', borderRadius:'0 3px 3px 0',
                height: hovered ? 20 : live ? 8 : 0, transition:'height 0.18s',
              }}/>
              <button className={`forum-pill ${hovered ? 'is-active' : ''}`}
                style={{background:`${color}22`, color, border:`2px solid ${live ? color+'99':'transparent'}`}}
                onClick={() => navigate(`/forum/${f.id}`)}
                onMouseEnter={() => setHoveredForum(f.id)}
                onMouseLeave={() => setHoveredForum(null)}>
                {f.name[0].toUpperCase()}
                <span className="pill-tip">{f.name}{live ? ' 🟢' : ''}</span>
              </button>
              {live && <div style={{position:'absolute',bottom:0,right:0,width:10,height:10,borderRadius:'50%',background:'var(--green)',border:'2px solid var(--bg)'}}/>}
            </div>
          )
        })}

        {forums.length===0 && (
          <button className="forum-pill" style={{background:'var(--bg2)',color:'var(--text-dim)',border:'2px dashed var(--border)'}} onClick={() => navigate('/forum')}>
            <Globe size={14}/>
            <span className="pill-tip">No public projects yet</span>
          </button>
        )}

        <div style={S.stripDivider}/>
        <button className="forum-pill" style={{background:'var(--teal-dim)',color:'var(--teal)',border:'2px dashed var(--teal)44'}} onClick={() => navigate('/forum')}>
          <Plus size={15}/>
          <span className="pill-tip">All public projects</span>
        </button>
      </div>

      {/* ── Sidebar ──────────────────────────────────────────────── */}
      <div style={S.sidebar}>
        <div style={S.brand}>
          <div style={{display:'flex',alignItems:'center',gap:9}}>
            <div style={S.brandIcon}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="var(--teal)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div>
              <div style={{fontWeight:800,fontSize:15,letterSpacing:'-0.03em'}}>Yantrik</div>
              <div style={{fontSize:10,color:'var(--text-dim)',fontFamily:'var(--mono)'}}>Collaborative AI for Teams</div>
            </div>
          </div>
        </div>



        {/* Forum list */}
        {forums.length > 0 && (
          <div style={S.section}>
            <div style={S.secLabel}>
              <Globe size={9} color="var(--teal)"/> OPEN FORUM
              <span style={{marginLeft:'auto',color:'var(--teal)',fontSize:10,fontFamily:'var(--mono)'}}>{liveCount} live</span>
            </div>
            {forums.slice(0,7).map(f => {
              const color = strColor(f.id)
              const live = isLive(f.last_activity)
              return (
                <button key={f.id} style={S.forumRow} onClick={()=>navigate(`/forum/${f.id}`)}
                  onMouseEnter={e=>(e.currentTarget as HTMLElement).style.background='var(--bg2)'}
                  onMouseLeave={e=>(e.currentTarget as HTMLElement).style.background='transparent'}>
                  <div style={{...S.miniIcon, background:`${color}22`, color, border:`1px solid ${color}44`}}>{f.name[0].toUpperCase()}</div>
                  <div style={{flex:1,minWidth:0,textAlign:'left'}}>
                    <div style={{fontSize:11,fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',color:live?'var(--text)':'var(--text-muted)'}}>{f.name}</div>
                    <div style={{fontSize:10,color:'var(--text-dim)',fontFamily:'var(--mono)'}}>{f.member_count}m · {f.message_count}msg</div>
                  </div>
                  {live && <div style={{width:6,height:6,borderRadius:'50%',background:'var(--green)',flexShrink:0,boxShadow:'0 0 5px var(--green)'}}/>}
                </button>
              )
            })}
            <button style={{...S.navBtn,marginTop:2}} onClick={()=>navigate('/forum')}
              onMouseEnter={e=>(e.currentTarget as HTMLElement).style.background='var(--bg2)'}
              onMouseLeave={e=>(e.currentTarget as HTMLElement).style.background='transparent'}>
              <Globe size={10} color="var(--teal)"/>
              <span style={{fontSize:11,color:'var(--teal)'}}>Browse all →</span>
            </button>
          </div>
        )}

        {/* Workspaces */}
        <div style={S.section}>
          <div style={S.secLabel}><Code2 size={9}/> MY WORKSPACES</div>
          <div style={{position:'relative',marginBottom:4}}>
            <Search size={10} style={{position:'absolute',left:8,top:'50%',transform:'translateY(-50%)',color:'var(--text-dim)',pointerEvents:'none'}}/>
            <input className="input" style={{paddingLeft:24,fontSize:11,padding:'5px 8px 5px 24px'}}
              placeholder="Search..." value={search} onChange={e=>setSearch(e.target.value)}/>
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:1,overflowY:'auto',maxHeight:180}}>
            {filtered.map(p=>(
              <button key={p.id} style={S.wsRow} onClick={()=>navigate(`/project/${p.id}`)}
                onMouseEnter={e=>(e.currentTarget as HTMLElement).style.background='var(--bg2)'}
                onMouseLeave={e=>(e.currentTarget as HTMLElement).style.background='transparent'}>
                <div style={{...S.miniIcon,background:'var(--teal-dim)',color:'var(--teal)',border:'none'}}>{p.name[0].toUpperCase()}</div>
                <div style={{flex:1,minWidth:0,textAlign:'left'}}>
                  <div style={{fontSize:11,fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.name}</div>
                  <div style={{fontSize:10,color:'var(--text-dim)',fontFamily:'var(--mono)'}}>{shortModel(p.my_model)}</div>
                </div>
                <ChevronRight size={10} color="var(--text-dim)"/>
              </button>
            ))}
            {filtered.length===0 && !search && (
              <p style={{fontSize:11,color:'var(--text-dim)',padding:'6px 4px',fontFamily:'var(--mono)'}}>// no workspaces yet</p>
            )}
          </div>
        </div>

        <div style={{flex:1}}/>

        {/* User */}
        <div style={S.userRow}>
          <div style={{...S.avatar,background:user?.avatar_color,cursor:'pointer'}} onClick={()=>navigate('/profile')}>
            {user?.username?.[0]?.toUpperCase()}
          </div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:12,fontWeight:700,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{user?.username}</div>
            <div style={{fontSize:10,color:'var(--teal)',fontFamily:'var(--mono)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{(user as any)?.uid || '...'}</div>
          </div>
          <button style={S.iBtn} onClick={()=>navigate('/profile')}><Settings size={13}/></button>
          <button style={S.iBtn} onClick={()=>{logout();navigate('/auth')}}><LogOut size={13}/></button>
        </div>
      </div>

      {/* ── Main ─────────────────────────────────────────────────── */}
      <div style={S.main}>
        <div style={S.header}>
          <div>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <h1 style={S.heading}>Workspaces</h1>
              {projects.length>0 && <span style={S.countBadge}>{projects.length}</span>}
            </div>
            <p style={S.sub}>Your collaborative AI projects</p>
          </div>
          <div style={{display:'flex',gap:6,alignItems:'center'}}>
            <button style={S.navLink} onClick={()=>navigate('/hackathon')}><Trophy size={13} color="var(--amber)"/> Hackathon</button>
            <button style={S.navLink} onClick={()=>navigate('/pricing')}><DollarSign size={13} color="var(--green)"/> Pricing</button>
            <button style={S.navLink} onClick={()=>navigate('/how-to-use')}><HelpCircle size={13} color="var(--blue)"/> How to Use</button>
            <div style={{width:1,height:18,background:'var(--border)',margin:'0 4px'}}/>
            <button className="btn btn-ghost" onClick={()=>setShowJoin(true)}><Hash size={13}/> Join</button>
            <button className="btn btn-primary" onClick={()=>setShowCreate(true)}><Plus size={13}/> New Workspace</button>
          </div>
        </div>

        {projects.length===0 ? (
          <div style={S.empty}>
            <div style={S.emptyIconWrap}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="var(--teal)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <p style={{fontWeight:700,fontSize:15}}>No workspaces yet</p>
            <p style={{fontSize:13,color:'var(--text-dim)',marginTop:4}}>Create one and start building with AI</p>
            <button className="btn btn-primary" style={{marginTop:14}} onClick={()=>setShowCreate(true)}>
              <Plus size={13}/> Create First Workspace
            </button>
          </div>
        ) : (
          <div style={S.grid}>
            {projects.map((p,i)=>(
              <div key={p.id} className="card" style={{...S.card, animationDelay:`${i*0.05}s`}}
                onClick={()=>navigate(`/project/${p.id}`)}
                onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.borderColor=`${strColor(p.id)}55`;(e.currentTarget as HTMLElement).style.transform='translateY(-2px)'}}
                onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.borderColor='var(--border)';(e.currentTarget as HTMLElement).style.transform='translateY(0)'}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                  <div style={{...S.projIcon,background:`${strColor(p.id)}20`,color:strColor(p.id)}}>{p.name[0].toUpperCase()}</div>
                  <span className="tag tag-teal" style={{fontSize:9}}>{shortModel(p.my_model)}</span>
                </div>
                <div style={{fontWeight:700,fontSize:13,letterSpacing:'-0.01em'}}>{p.name}</div>
                {p.description && <div style={{fontSize:12,color:'var(--text-muted)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.description}</div>}
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginTop:4}}>
                  <span style={{display:'flex',alignItems:'center',gap:4,fontSize:11,color:'var(--text-muted)'}}><Users size={10}/>{p.member_count}</span>
                  <button style={S.codeBtn} onClick={e=>{e.stopPropagation();navigator.clipboard.writeText(p.invite_code);setCopied(p.invite_code);setTimeout(()=>setCopied(null),2000)}}>
                    {copied===p.invite_code?<Check size={10} color="var(--green)"/>:<Copy size={10}/>}
                    <span style={{fontFamily:'var(--mono)',fontSize:10}}>{p.invite_code}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Live Forum preview */}
        {forums.length > 0 && (
          <div style={S.forumSection}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}>
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                <Globe size={14} color="var(--teal)"/>
                <span style={{fontWeight:700,fontSize:14,letterSpacing:'-0.01em'}}>Open Forum</span>
                {liveCount > 0 && (
                  <span style={{display:'flex',alignItems:'center',gap:4,background:'var(--green-dim)',border:'1px solid var(--green)33',borderRadius:20,padding:'2px 8px',fontSize:10,color:'var(--green)',fontFamily:'var(--mono)',fontWeight:700}}>
                    <div style={{width:5,height:5,borderRadius:'50%',background:'var(--green)',animation:'pulse 2s infinite'}}/>
                    {liveCount} LIVE
                  </span>
                )}
              </div>
              <button className="btn btn-ghost" style={{fontSize:12,padding:'4px 10px'}} onClick={()=>navigate('/forum')}>
                View all <ChevronRight size={12}/>
              </button>
            </div>
            <div style={S.forumGrid}>
              {forums.slice(0,4).map(f=>{
                const color = strColor(f.id)
                const live = isLive(f.last_activity)
                return (
                  <div key={f.id} style={S.forumCard}
                    onClick={()=>navigate(`/forum/${f.id}`)}
                    onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.borderColor=`${color}55`;(e.currentTarget as HTMLElement).style.background='var(--bg2)'}}
                    onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.borderColor='var(--border)';(e.currentTarget as HTMLElement).style.background='var(--bg1)'}}>
                    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
                      <div style={{...S.forumCardIcon,background:`${color}20`,color,border:`1px solid ${color}44`}}>{f.name[0].toUpperCase()}</div>
                      {live && <span style={{display:'flex',alignItems:'center',gap:3,fontSize:10,color:'var(--green)',fontFamily:'var(--mono)',background:'var(--green-dim)',padding:'2px 6px',borderRadius:20}}>
                        <div style={{width:4,height:4,borderRadius:'50%',background:'var(--green)'}}/>LIVE
                      </span>}
                    </div>
                    <div style={{fontWeight:700,fontSize:13,marginBottom:3,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{f.name}</div>
                    <div style={{fontSize:11,color:'var(--text-dim)',marginBottom:10,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{f.description||`by ${f.owner_name}`}</div>
                    <div style={{display:'flex',gap:10,borderTop:'1px solid var(--border)',paddingTop:8}}>
                      {[[<Users size={9}/>,f.member_count],[<Eye size={9}/>,f.viewer_count],[<MessageSquare size={9}/>,f.message_count],[<Bot size={9}/>,f.agent_count]].map(([icon,val]:any,i)=>(
                        <span key={i} style={{display:'flex',alignItems:'center',gap:3,fontSize:10,color:'var(--text-dim)'}}>{icon}{val}</span>
                      ))}
                      {f.last_activity && <span style={{marginLeft:'auto',fontSize:10,color:'var(--text-dim)',fontFamily:'var(--mono)'}}>{timeAgo(f.last_activity)}</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Modal */}
      {(showCreate||showJoin) && (
        <div style={S.overlay} onClick={()=>{setShowCreate(false);setShowJoin(false)}}>
          <div className="card fade-up" style={S.modal} onClick={e=>e.stopPropagation()}>
            <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:18}}>
              <div style={{width:30,height:30,borderRadius:8,background:'var(--teal-dim)',display:'flex',alignItems:'center',justifyContent:'center'}}>
                {showCreate?<Plus size={14} color="var(--teal)"/>:<Hash size={14} color="var(--teal)"/>}
              </div>
              <h2 style={{fontSize:16,fontWeight:700}}>{showCreate?'New Workspace':'Join Workspace'}</h2>
            </div>
            <form onSubmit={showCreate?createProject:joinProject} style={{display:'flex',flexDirection:'column',gap:13}}>
              {showCreate?(
                <>
                  <div><label style={S.label}>Workspace Name</label><input className="input" placeholder="e.g. Dragon v2" value={name} onChange={e=>setName(e.target.value)} required autoFocus/></div>
                  <div><label style={S.label}>Description <span style={{color:'var(--text-dim)',fontWeight:400}}>(optional)</span></label><input className="input" placeholder="What are you building?" value={desc} onChange={e=>setDesc(e.target.value)}/></div>
                </>
              ):(
                <div><label style={S.label}>Invite Code</label><input className="input" placeholder="Paste code" value={code} onChange={e=>setCode(e.target.value)} required autoFocus style={{fontFamily:'var(--mono)',letterSpacing:'0.05em'}}/></div>
              )}
              <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:4}}>
                <button type="button" className="btn btn-ghost" onClick={()=>{setShowCreate(false);setShowJoin(false)}}>Cancel</button>
                <button className="btn btn-primary" disabled={loading}>{loading?'Loading...':showCreate?'Create':'Join'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}.forum-pill:hover .pill-tip{opacity:1!important}`}</style>
    </div>
  )
}

const S: Record<string,React.CSSProperties> = {
  root:{display:'flex',height:'100vh',overflow:'hidden',background:'var(--bg)'},
  strip:{width:62,background:'#090b0f',display:'flex',flexDirection:'column',alignItems:'center',padding:'10px 0',gap:6,flexShrink:0,borderRight:'1px solid var(--border)'},
  stripLogo:{width:40,height:40,borderRadius:12,background:'var(--teal)',color:'#0c0e12',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',marginBottom:2,transition:'border-radius 0.15s, box-shadow 0.2s',boxShadow:'0 0 14px var(--teal-glow)'},
  stripDivider:{width:28,height:1,background:'var(--border)',margin:'3px 0',flexShrink:0},
  sidebar:{width:228,background:'var(--bg1)',display:'flex',flexDirection:'column',flexShrink:0,borderRight:'1px solid var(--border)',overflow:'hidden'},
  brand:{padding:'14px 12px 10px',borderBottom:'1px solid var(--border)'},
  brandIcon:{width:28,height:28,borderRadius:7,background:'var(--teal-dim)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0},
  navBtn:{display:'flex',alignItems:'center',gap:7,padding:'5px 8px',background:'transparent',border:'none',borderRadius:5,cursor:'pointer',color:'var(--text-muted)',fontFamily:'var(--font)',transition:'background 0.1s,color 0.1s',width:'100%'},
  section:{padding:'6px 8px',borderTop:'1px solid var(--border)'},
  secLabel:{display:'flex',alignItems:'center',gap:5,fontSize:10,fontWeight:700,color:'var(--text-dim)',fontFamily:'var(--mono)',letterSpacing:'0.08em',padding:'5px 4px 5px'},
  forumRow:{display:'flex',alignItems:'center',gap:7,padding:'4px 5px',background:'transparent',border:'none',borderRadius:5,cursor:'pointer',transition:'background 0.1s',width:'100%',fontFamily:'var(--font)'},
  wsRow:{display:'flex',alignItems:'center',gap:7,padding:'4px 5px',background:'transparent',border:'none',borderRadius:5,cursor:'pointer',transition:'background 0.1s',width:'100%',fontFamily:'var(--font)',color:'var(--text-muted)'},
  miniIcon:{width:22,height:22,borderRadius:5,display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,fontWeight:800,flexShrink:0},
  userRow:{display:'flex',alignItems:'center',gap:8,padding:'10px 10px',borderTop:'1px solid var(--border)'},
  avatar:{width:27,height:27,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700,color:'#fff',flexShrink:0},
  iBtn:{background:'none',border:'none',color:'var(--text-dim)',cursor:'pointer',padding:4,borderRadius:4,display:'flex',alignItems:'center'},
  main:{flex:1,overflow:'auto',padding:'24px 26px',display:'flex',flexDirection:'column',gap:22},
  header:{display:'flex',alignItems:'flex-start',justifyContent:'space-between'},
  heading:{fontSize:21,fontWeight:800,letterSpacing:'-0.03em'},
  sub:{color:'var(--text-muted)',fontSize:12,marginTop:3},
  countBadge:{fontSize:11,color:'var(--text-dim)',fontFamily:'var(--mono)',background:'var(--bg2)',padding:'2px 7px',borderRadius:20,border:'1px solid var(--border)'},
  grid:{display:'grid',gridTemplateColumns:'repeat(auto-fill, minmax(230px, 1fr))',gap:10},
  card:{cursor:'pointer',padding:14,display:'flex',flexDirection:'column',gap:8,animation:'fadeUp 0.25s ease forwards',opacity:0,transition:'border-color 0.15s,transform 0.15s'},
  projIcon:{width:30,height:30,borderRadius:7,display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,fontWeight:800},
  codeBtn:{display:'flex',alignItems:'center',gap:4,background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:4,padding:'2px 6px',color:'var(--text-dim)',fontSize:10,cursor:'pointer',fontFamily:'var(--mono)'},
  empty:{display:'flex',flexDirection:'column',alignItems:'center',gap:8,padding:'50px 20px',color:'var(--text-muted)',textAlign:'center'},
  emptyIconWrap:{width:60,height:60,borderRadius:16,background:'var(--teal-dim)',display:'flex',alignItems:'center',justifyContent:'center',marginBottom:6},
  forumSection:{background:'var(--bg1)',border:'1px solid var(--border)',borderRadius:12,padding:'15px 16px'},
  forumGrid:{display:'grid',gridTemplateColumns:'repeat(auto-fill, minmax(190px, 1fr))',gap:8},
  forumCard:{background:'var(--bg1)',border:'1px solid var(--border)',borderRadius:10,padding:12,cursor:'pointer',transition:'border-color 0.15s,background 0.15s'},
  forumCardIcon:{width:32,height:32,borderRadius:9,display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,fontWeight:800},
  overlay:{position:'fixed',inset:0,background:'rgba(0,0,0,0.82)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:100},
  modal:{width:'100%',maxWidth:400,padding:22},
  navLink:{background:'none',border:'none',color:'var(--text-muted)',cursor:'pointer',fontSize:12,fontWeight:600,fontFamily:'var(--font)',display:'flex',alignItems:'center',gap:5,padding:'5px 8px',borderRadius:6,transition:'color 0.12s'},
  label:{display:'block',fontSize:11,fontWeight:600,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.06em',fontFamily:'var(--mono)',marginBottom:5},
}
