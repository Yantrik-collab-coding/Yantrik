import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Send, Bot, Users, Copy, Check, Zap,
  FilePlus, File, Trash2, RotateCcw, ChevronDown, X, History, Download
} from 'lucide-react'
import Editor from '@monaco-editor/react'
import api from '../lib/api'
import { useAuthStore } from '../lib/store'
import DiffViewer from '../components/DiffViewer'
import AgentSteps, { Step } from '../components/AgentSteps'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Message {
  id: string; author_name: string; author_id?: string; avatar_color?: string
  content: string; is_agent: boolean; agent_model?: string
  triggered_by?: string; timestamp: string; type?: string
  // IDE additions:
  _planMsg?:  { job_id: string; goal: string; steps: Step[]; username: string; avatarColor: string }
}

interface WorkspaceFile { id: string; filename: string; language: string; content?: string }
interface PendingDiff   { id: string; job_id: string; filename: string; diff_text: string; old_content: string; new_content: string; lines_added: number; lines_removed: number; risk_level: string }
interface Member        { id: string; username: string; avatar_color: string; model: string }
interface Project       { id: string; name: string; description: string; invite_code: string; members: Member[]; my_model: string }

interface ModelDef { id: string; name: string; provider: string; tier: string; available: boolean }

type Panel = 'chat' | 'members'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function modelName(id: string, models: ModelDef[]) { return models.find(m => m.id === id)?.name || id }
function formatTime(ts: string) { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }

function langIcon(lang: string): string {
  const m: Record<string, string> = { python: '🐍', typescript: '🔷', javascript: '🟨', html: '🌐', css: '🎨', json: '{}', markdown: '📝', bash: '⚡', sql: '🗃️', rust: '🦀', go: '🐹' }
  return m[lang] || '📄'
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user, token } = useAuthStore()

  // Project state
  const [project, setProject]     = useState<Project | null>(null)
  const [myModel, setMyModel]     = useState('llama-3.3-70b-versatile')
  const [models, setModels]       = useState<ModelDef[]>([])
  const [copied, setCopied]       = useState(false)
  const [connected, setConnected] = useState(false)

  // Chat state
  const [messages, setMessages]     = useState<Message[]>([])
  const [input, setInput]           = useState('')
  const [agentTyping, setAgentTyping] = useState<{ username: string; model: string } | null>(null)
  const [activePanel, setActivePanel] = useState<Panel>('chat')
  const [activeJobs, setActiveJobs] = useState<Record<string, { goal: string; steps: Step[] }>>({})

  // File tree state
  const [files, setFiles]                 = useState<WorkspaceFile[]>([])
  const [fileLimits, setFileLimits]       = useState<{tier:string,file_count:number,max_files:number,max_kb:number,remaining:number} | null>(null)
  const [runOutput, setRunOutput]         = useState<{stdout:string,stderr:string,exit_code:number} | null>(null)
  const [running, setRunning]             = useState(false)
  const [showTerminal, setShowTerminal]   = useState(false)
  const [activeFile, setActiveFile]       = useState<WorkspaceFile | null>(null)
  const [activeContent, setActiveContent] = useState('')
  const [unsaved, setUnsaved]             = useState(false)
  const [showNewFile, setShowNewFile]     = useState(false)
  const [newFileName, setNewFileName]     = useState('')
  const [showVersions, setShowVersions]   = useState(false)
  const [versions, setVersions]           = useState<any[]>([])

  // Diff state
  const [pendingDiffs, setPendingDiffs]       = useState<PendingDiff[]>([])
  const [reviewDiffId, setReviewDiffId]       = useState<string | null>(null)
  const [diffLoading, setDiffLoading]         = useState<string | null>(null)
  const [showDiffPanel, setShowDiffPanel]     = useState(false)

  // No-key banner: shown when user calls @agent without having an API key saved
  const [noKeyBanner, setNoKeyBanner] = useState<{ provider: string; key_url: string; model: string } | null>(null)

  const wsRef     = useRef<WebSocket | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef  = useRef<HTMLTextAreaElement>(null)

  // ── Load project + files ────────────────────────────────────────────────────
  useEffect(() => {
    if (!id) return
    api.get(`/projects/${id}`).then(r => { setProject(r.data); setMyModel(r.data.my_model) }).catch(() => navigate('/'))
    api.get('/projects/models').then(r => setModels(r.data)).catch(() => {})
    api.get(`/projects/${id}/messages`).then(r => setMessages(r.data.map((m: any) => ({ ...m, timestamp: m.created_at }))))
    loadFiles()
    loadPendingDiffs()
  }, [id])

  async function runFile() {
    if (!activeFile || !id) return
    const RUNNABLE = ['python', 'javascript', 'bash']
    if (!RUNNABLE.includes(activeFile.language)) {
      setRunOutput({ stdout: '', stderr: `Cannot run ${activeFile.language} files in the browser.\n\nFull terminal execution is coming in the Hive Desktop App.`, exit_code: 1 })
      setShowTerminal(true)
      return
    }
    setRunning(true)
    setShowTerminal(true)
    setRunOutput(null)
    try {
      const { data } = await api.post(`/projects/${id}/files/${activeFile.id}/run`)
      setRunOutput(data)
    } catch (err: any) {
      setRunOutput({ stdout: '', stderr: err.response?.data?.detail || 'Run failed', exit_code: 1 })
    } finally { setRunning(false) }
  }

  async function loadFiles() {
    if (!id) return
    const r = await api.get(`/projects/${id}/files`)
    // New format: { files, tier, file_count, max_files, max_kb }
    if (r.data.files) {
      setFiles(r.data.files)
      setFileLimits({ tier: r.data.tier, file_count: r.data.file_count, max_files: r.data.max_files, max_kb: r.data.max_kb, remaining: r.data.max_files - r.data.file_count })
    } else {
      setFiles(r.data) // fallback for old format
    }
  }

  async function loadPendingDiffs() {
    if (!id) return
    try { const r = await api.get(`/projects/${id}/diffs`); setPendingDiffs(r.data) } catch {}
  }

  async function openFile(f: WorkspaceFile) {
    if (unsaved && activeFile) {
      if (!confirm(`Discard unsaved changes to ${activeFile.filename}?`)) return
    }
    const r = await api.get(`/projects/${id}/files/${f.id}`)
    setActiveFile({ ...f, content: r.data.content })
    setActiveContent(r.data.content)
    setUnsaved(false)
    setShowVersions(false)
  }

  async function saveFile() {
    if (!activeFile || !id) return
    await api.put(`/projects/${id}/files/${activeFile.id}`, { content: activeContent, message: 'Manual save' })
    setUnsaved(false)
  }

  async function createFile() {
    if (!newFileName.trim() || !id) return
    try {
      const r = await api.post(`/projects/${id}/files`, { filename: newFileName.trim() })
      setShowNewFile(false); setNewFileName('')
      await loadFiles()
      await openFile(r.data)
    } catch { alert('Filename already exists') }
  }

  async function deleteFile(f: WorkspaceFile) {
    if (!id || !confirm(`Delete ${f.filename}?`)) return
    await api.delete(`/projects/${id}/files/${f.id}`)
    if (activeFile?.id === f.id) { setActiveFile(null); setActiveContent('') }
    await loadFiles()
  }

  async function loadVersions() {
    if (!activeFile || !id) return
    const r = await api.get(`/projects/${id}/files/${activeFile.id}/versions`)
    setVersions(r.data); setShowVersions(true)
  }

  async function rollback(versionId: string) {
    if (!activeFile || !id || !confirm('Rollback to this version?')) return
    const r = await api.post(`/projects/${id}/files/${activeFile.id}/rollback/${versionId}`)
    setActiveContent(r.data.restored_content)
    setUnsaved(false); setShowVersions(false)
  }

  // ── WebSocket ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!id || !token) return
    const wsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/api/chat/ws/${id}?token=${token}`
    const ws    = new WebSocket(wsUrl)
    wsRef.current = ws
    ws.onopen  = () => setConnected(true)
    ws.onclose = () => setConnected(false)
    ws.onmessage = e => handleWsMessage(JSON.parse(e.data))
    return () => ws.close()
  }, [id, token])

  function handleWsMessage(data: any) {
    const ts = data.timestamp || new Date().toISOString()

    if (data.type === 'agent_typing') {
      setAgentTyping({ username: data.username, model: data.model }); return
    }
    if (data.type === 'message') {
      setAgentTyping(null)
      setMessages(prev => [...prev, { ...data, timestamp: ts }]); return
    }
    if (data.type === 'system') {
      setMessages(prev => [...prev, { id: Date.now().toString(), author_name: 'system', content: data.content, is_agent: false, timestamp: ts, type: 'system' }]); return
    }

    // ── IDE events ─────────────────────────────────────────────────────────
    if (data.type === 'agent_thinking') {
      setMessages(prev => [...prev, {
        id: `thinking-${data.username}-${Date.now()}`, author_name: `${data.username}'s Agent`,
        content: data.message, is_agent: true, timestamp: ts, type: 'thinking'
      }]); return
    }

    if (data.type === 'agent_plan') {
      const steps: Step[] = data.steps.map((s: any) => ({
        step_number: s.step_number, action: s.action, target_file: s.target_file,
        status: 'pending'
      }))
      setActiveJobs(prev => ({ ...prev, [data.job_id]: { goal: data.goal, steps } }))
      const member = project?.members.find(m => m.username === data.username)
      setMessages(prev => [...prev, {
        id: `plan-${data.job_id}`, author_name: `${data.username}'s Agent`,
        content: '', is_agent: true, timestamp: ts,
        _planMsg: { job_id: data.job_id, goal: data.goal, steps, username: data.username, avatarColor: member?.avatar_color || '#6366f1' }
      }]); return
    }

    if (data.type === 'agent_step_start') {
      setActiveJobs(prev => {
        const job = prev[data.job_id]
        if (!job) return prev
        return { ...prev, [data.job_id]: { ...job, steps: job.steps.map(s => s.step_number === data.step_number ? { ...s, status: 'running' } : s) } }
      }); return
    }

    if (data.type === 'agent_step_done') {
      setActiveJobs(prev => {
        const job = prev[data.job_id]
        if (!job) return prev
        return { ...prev, [data.job_id]: { ...job, steps: job.steps.map(s => s.step_number === data.step_number ? { ...s, status: data.status, output: data.output, diff_id: data.diff_id, lines_added: data.lines_added, lines_removed: data.lines_removed, risk_level: data.risk_level, error: data.error } : s) } }
      })
      if (data.diff_id) { loadPendingDiffs(); setShowDiffPanel(true) }
      return
    }

    if (data.type === 'agent_job_done') {
      setTimeout(() => setActiveJobs(prev => { const n = { ...prev }; delete n[data.job_id]; return n }), 30000); return
    }

    if (data.type === 'file_accepted') {
      loadFiles(); loadPendingDiffs()
      if (activeFile?.filename === data.filename) {
        setActiveContent(data.content || ''); setUnsaved(false)
      }; return
    }

    if (data.type === 'file_rejected') {
      loadPendingDiffs(); return
    }

    // ── No API key — show banner to this user only ──────────────────────────
    if (data.type === 'agent_no_key') {
      setNoKeyBanner({ provider: data.provider, key_url: data.key_url, model: data.model })
      return
    }

    // ── Agent error — show as a system message in chat ─────────────────────
    if (data.type === 'agent_error') {
      setMessages(prev => [...prev, {
        id: `err-${Date.now()}`, author_name: 'System',
        content: data.error, is_agent: false, timestamp: ts, type: 'agent_error'
      }]); return
    }
  }

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, agentTyping])

  // ── Send message ───────────────────────────────────────────────────────────
  function sendMessage() {
    const content = input.trim()
    if (!content || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
    wsRef.current.send(JSON.stringify({ type: 'message', content }))
    setInput('')
    inputRef.current?.focus()
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  async function updateModel(model: string) {
    setMyModel(model)
    await api.patch(`/projects/${id}/model`, { model })
  }

  function copyInvite() {
    if (project) { navigator.clipboard.writeText(project.invite_code); setCopied(true); setTimeout(() => setCopied(false), 2000) }
  }

  async function downloadProject() {
    if (!project || !token) return
    const res = await fetch(`/api/projects/${id}/download`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (!res.ok) return
    const blob = await res.blob()
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `${project.name}.zip`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Diff actions ───────────────────────────────────────────────────────────
  async function acceptDiff(diffId: string) {
    if (!id) return
    setDiffLoading(diffId)
    try {
      const r = await api.post(`/projects/${id}/diffs/${diffId}/accept`)
      wsRef.current?.send(JSON.stringify({ type: 'diff_accepted', diff_id: diffId, file_id: r.data.file_id, filename: r.data.filename, content: r.data.content }))
      setPendingDiffs(prev => prev.filter(d => d.id !== diffId))
      await loadFiles()
      if (activeFile?.filename === r.data.filename) { setActiveContent(r.data.content); setUnsaved(false) }
      if (reviewDiffId === diffId) setReviewDiffId(null)
    } finally { setDiffLoading(null) }
  }

  async function rejectDiff(diffId: string) {
    if (!id) return
    setDiffLoading(diffId)
    try {
      await api.post(`/projects/${id}/diffs/${diffId}/reject`)
      wsRef.current?.send(JSON.stringify({ type: 'diff_rejected', diff_id: diffId, filename: pendingDiffs.find(d => d.id === diffId)?.filename }))
      setPendingDiffs(prev => prev.filter(d => d.id !== diffId))
      if (reviewDiffId === diffId) setReviewDiffId(null)
    } finally { setDiffLoading(null) }
  }

  const reviewDiff = pendingDiffs.find(d => d.id === reviewDiffId)

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--bg)' }}>

      {/* ── Left: Project sidebar ─────────────────────────────────── */}
      <div style={{ width: 'var(--sidebar-w)', background: 'var(--bg1)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid var(--border)' }}>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/')}>
            <ArrowLeft size={13} /> Back
          </button>
          {project && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{project.name}</div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 8 }}>{project.description}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <code style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg2)', padding: '4px 7px', borderRadius: 4, border: '1px solid var(--border)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project.invite_code}</code>
                <button style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 6px', cursor: 'pointer', color: 'var(--text-muted)' }} onClick={copyInvite}>
                  {copied ? <Check size={11} color="var(--green)" /> : <Copy size={11} />}
                </button>
                <button style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 6px', cursor: 'pointer', color: 'var(--text-muted)' }} onClick={downloadProject} title="Download project as ZIP">
                  <Download size={11} />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Nav tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
          {(['chat', 'members'] as Panel[]).map(p => (
            <button key={p} onClick={() => setActivePanel(p)} style={{ flex: 1, padding: '8px 0', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', background: 'none', border: 'none', cursor: 'pointer', color: activePanel === p ? 'var(--accent)' : 'var(--text-dim)', borderBottom: activePanel === p ? '2px solid var(--accent)' : '2px solid transparent', fontFamily: 'var(--font-mono)' }}>
              {p}
            </button>
          ))}
        </div>

        {activePanel === 'members' && project && (
          <div style={{ padding: 12, overflow: 'auto', flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8, fontFamily: 'var(--font-mono)' }}>
              <Users size={11} style={{ display: 'inline', marginRight: 4 }} /> {project.members.length} Members
            </div>
            {project.members.map(m => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <div style={{ width: 26, height: 26, borderRadius: '50%', background: m.avatar_color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                  {m.username[0].toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{m.username}{m.id === user?.id && <span style={{ marginLeft: 4, fontSize: 10, background: 'var(--accent-dim)', color: 'var(--accent)', padding: '1px 4px', borderRadius: 3 }}>you</span>}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{modelName(m.model, models)}</div>
                </div>
              </div>
            ))}
            <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8, fontFamily: 'var(--font-mono)' }}>
                <Bot size={11} style={{ display: 'inline', marginRight: 4 }} /> My Agent
              </div>
              <select value={myModel} onChange={e => updateModel(e.target.value)} style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', color: 'var(--text)', fontSize: 11, fontFamily: 'var(--font-display)', outline: 'none', cursor: 'pointer' }}>
                {models.map(m => <option key={m.id} value={m.id} disabled={!m.available}>{m.available ? '' : '🔒 '}{m.name} ({m.provider})</option>)}
              </select>
            </div>
          </div>
        )}

        {activePanel === 'chat' && (
          <div style={{ padding: 12, fontSize: 11, color: 'var(--text-dim)', flex: 1, overflow: 'auto' }}>
            <div style={{ fontFamily: 'var(--font-mono)', marginBottom: 6 }}>Agent commands:</div>
            {['@agent create a new utils.py', '@agent modify main.py to add logging', '@agent explain how auth works'].map(ex => (
              <div key={ex} style={{ marginBottom: 4, padding: '4px 6px', background: 'var(--bg2)', borderRadius: 4, cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)' }} onClick={() => { setInput(ex); inputRef.current?.focus() }}>
                {ex}
              </div>
            ))}
            <div style={{ marginTop: 14, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-dim)' }}>My model:</div>
            <select value={myModel} onChange={e => updateModel(e.target.value)} style={{ width: '100%', marginTop: 4, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 5, padding: '5px 7px', color: 'var(--text)', fontSize: 11, fontFamily: 'var(--font-display)', outline: 'none', cursor: 'pointer' }}>
              {models.map(m => <option key={m.id} value={m.id} disabled={!m.available}>{m.available ? '' : '🔒 '}{m.name} ({m.provider})</option>)}
            </select>
          </div>
        )}
      </div>

      {/* ── Middle: File tree + Editor ───────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* File tree header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--bg1)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.07em', fontFamily: 'var(--font-mono)', flex: 1 }}>
            Explorer
          </span>
          {pendingDiffs.length > 0 && (
            <button
              className="btn btn-sm"
              style={{ background: 'var(--amber-dim)', color: 'var(--amber)', border: '1px solid #fbbf2433', fontSize: 11 }}
              onClick={() => setShowDiffPanel(p => !p)}
            >
              {pendingDiffs.length} pending diff{pendingDiffs.length !== 1 ? 's' : ''}
            </button>
          )}
          <button className="btn btn-icon btn-ghost btn-sm" title="New file" onClick={() => setShowNewFile(p => !p)}><FilePlus size={13} /></button>
        </div>

        {/* New file input */}
        {showNewFile && (
          <div style={{ display: 'flex', gap: 6, padding: '6px 10px', background: 'var(--bg2)', borderBottom: '1px solid var(--border)' }}>
            <input
              className="input" placeholder="filename.py" value={newFileName}
              onChange={e => setNewFileName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') createFile(); if (e.key === 'Escape') { setShowNewFile(false); setNewFileName('') } }}
              autoFocus style={{ fontSize: 12, padding: '5px 8px' }}
            />
            <button className="btn btn-success btn-sm" onClick={createFile}>Create</button>
            <button className="btn btn-ghost btn-sm" onClick={() => { setShowNewFile(false); setNewFileName('') }}>✕</button>
          </div>
        )}

        {/* File limit bar */}
        {fileLimits && (
          <div style={{ padding: '6px 12px', background: 'var(--bg1)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                {fileLimits.file_count}/{fileLimits.max_files} files · {fileLimits.max_kb}KB max · <span style={{ color: fileLimits.tier === 'free' ? 'var(--accent)' : 'var(--green)', fontWeight: 700 }}>{fileLimits.tier}</span>
              </span>
              {fileLimits.tier === 'free' && (
                <a href="/profile" style={{ fontSize: 10, color: 'var(--accent)', fontFamily: 'var(--font-mono)', textDecoration: 'none' }}>upgrade ↗</a>
              )}
            </div>
            <div style={{ height: 3, background: 'var(--bg3)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 2, transition: 'width 0.3s',
                width: `${Math.min(100, (fileLimits.file_count / fileLimits.max_files) * 100)}%`,
                background: fileLimits.file_count >= fileLimits.max_files ? 'var(--red)' :
                            fileLimits.file_count >= fileLimits.max_files * 0.8 ? 'var(--accent)' : 'var(--green)'
              }} />
            </div>
          </div>
        )}

        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* File list */}
          <div style={{ width: 'var(--filetree-w)', background: 'var(--bg1)', borderRight: '1px solid var(--border)', overflow: 'auto', flexShrink: 0 }}>
            {files.length === 0 ? (
              <div style={{ padding: 16, color: 'var(--text-dim)', fontSize: 12, textAlign: 'center' }}>
                No files yet.<br />Ask <code style={{ color: 'var(--accent)' }}>@agent</code> to create one!
              </div>
            ) : files.map(f => {
              const hasDiff = pendingDiffs.some(d => d.filename === f.filename)
              return (
                <div
                  key={f.id}
                  onClick={() => openFile(f)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', cursor: 'pointer', background: activeFile?.id === f.id ? 'var(--bg2)' : 'transparent', borderLeft: activeFile?.id === f.id ? '2px solid var(--accent)' : '2px solid transparent', transition: 'all 0.1s' }}
                  onMouseEnter={e => { if (activeFile?.id !== f.id) (e.currentTarget as HTMLDivElement).style.background = 'var(--bg2)' }}
                  onMouseLeave={e => { if (activeFile?.id !== f.id) (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
                >
                  <span style={{ fontSize: 13 }}>{langIcon(f.language)}</span>
                  <span style={{ flex: 1, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: activeFile?.id === f.id ? 'var(--text)' : 'var(--text-muted)' }}>{f.filename}</span>
                  {hasDiff && <span className="tag tag-amber" style={{ fontSize: 9, padding: '1px 4px' }}>diff</span>}
                  <button
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', padding: 2, opacity: 0, transition: 'opacity 0.1s' }}
                    onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.opacity = '1'}
                    onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.opacity = '0'}
                    onClick={e => { e.stopPropagation(); deleteFile(f) }}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              )
            })}
          </div>

          {/* Editor area */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {activeFile ? (
              <>
                {/* Editor header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: 'var(--bg2)', borderBottom: '1px solid var(--border)', flexShrink: 0, minWidth: 0 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                    {langIcon(activeFile.language)} {activeFile.filename}
                    {unsaved && <span style={{ marginLeft: 6, color: 'var(--amber)', fontSize: 11 }}>●</span>}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                    <button className="btn btn-icon btn-ghost btn-sm" title="Version history" onClick={loadVersions}><History size={13} /></button>
                    <button className="btn btn-sm btn-ghost" onClick={saveFile} disabled={!unsaved} style={{ opacity: unsaved ? 1 : 0.4, padding: '3px 8px', fontSize: 11 }}>Save</button>
                    <button
                      style={{ padding: '3px 8px', fontSize: 11, background: running ? 'var(--bg3)' : '#238636', color: running ? 'var(--text-dim)' : '#fff', border: 'none', borderRadius: 5, cursor: 'pointer', fontFamily: 'var(--font-display)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}
                      onClick={runFile}
                      disabled={running}
                      title="Run file"
                    >
                      {running ? '⏳' : '▶'} {running ? 'Running' : 'Run'}
                    </button>
                    <button
                      style={{ padding: '3px 8px', fontSize: 11, background: showTerminal ? 'var(--bg3)' : 'var(--bg)', color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: 5, cursor: 'pointer', fontFamily: 'var(--font-display)', whiteSpace: 'nowrap' }}
                      onClick={() => setShowTerminal(p => !p)}
                      title="Toggle terminal"
                    >⬛ Terminal</button>
                  </div>
                </div>

                {/* Version history panel */}
                {showVersions && (
                  <div style={{ background: 'var(--bg2)', borderBottom: '1px solid var(--border)', padding: 10, maxHeight: 180, overflow: 'auto', flexShrink: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', flex: 1 }}>VERSION HISTORY</span>
                      <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)' }} onClick={() => setShowVersions(false)}><X size={12} /></button>
                    </div>
                    {versions.length === 0 ? (
                      <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>No versions saved yet.</div>
                    ) : versions.map(v => (
                      <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', flex: 1 }}>
                          {new Date(v.created_at).toLocaleString()} — {v.message || 'saved'} <span style={{ color: 'var(--text-dim)' }}>by {v.saved_by}</span>
                        </span>
                        <button className="btn btn-icon btn-ghost btn-sm" title="Restore" onClick={() => rollback(v.id)}><RotateCcw size={11} /></button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Monaco Editor */}
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <Editor
                    height="100%"
                    language={activeFile.language}
                    value={activeContent}
                    theme="vs-dark"
                    onChange={v => { setActiveContent(v || ''); setUnsaved(true) }}
                    options={{
                      fontSize: 13,
                      fontFamily: 'JetBrains Mono, monospace',
                      minimap: { enabled: false },
                      scrollBeyondLastLine: false,
                      lineNumbers: 'on',
                      wordWrap: 'on',
                      tabSize: 2,
                      padding: { top: 12 },
                    }}
                  />
                </div>
              </>
            ) : (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', gap: 12 }}>
                <span style={{ fontSize: 40 }}>⬡</span>
                <div style={{ textAlign: 'center', fontSize: 13 }}>
                  Select a file to edit, or ask<br />
                  <code style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>@agent create a new file</code> in chat
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Diff panel (slides up from bottom of editor) */}
        {showDiffPanel && pendingDiffs.length > 0 && (
          <div style={{ height: 340, background: 'var(--bg1)', borderTop: '1px solid var(--border)', overflow: 'auto', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--amber)', textTransform: 'uppercase', letterSpacing: '0.07em', fontFamily: 'var(--font-mono)', flex: 1 }}>
                Pending Diffs ({pendingDiffs.length})
              </span>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)' }} onClick={() => setShowDiffPanel(false)}><X size={13} /></button>
            </div>
            <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {pendingDiffs.map(d => (
                <DiffViewer
                  key={d.id}
                  diffText={d.diff_text}
                  filename={d.filename}
                  linesAdded={d.lines_added}
                  linesRemoved={d.lines_removed}
                  riskLevel={d.risk_level as any}
                  onAccept={() => acceptDiff(d.id)}
                  onReject={() => rejectDiff(d.id)}
                  loading={diffLoading === d.id}
                />
              ))}
            </div>
          </div>
        )}

        {/* Terminal panel */}
        {showTerminal && (
          <div style={{ height: 220, background: '#0d1117', borderTop: '1px solid var(--border)', flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', padding: '6px 12px', borderBottom: '1px solid #21262d', flexShrink: 0 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#58a6ff', fontFamily: 'var(--font-mono)', flex: 1 }}>
                ⬛ TERMINAL {activeFile ? `— ${activeFile.filename}` : ''}
              </span>
              {running && <span style={{ fontSize: 10, color: '#f0a500', fontFamily: 'var(--font-mono)', marginRight: 10 }}>● running...</span>}
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#7d8590', fontSize: 14 }} onClick={() => setShowTerminal(false)}>✕</button>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.6 }}>
              {!runOutput && running && (
                <span style={{ color: '#7d8590' }}>Running {activeFile?.filename}...</span>
              )}
              {!runOutput && !running && (
                <span style={{ color: '#7d8590' }}>Press ▶ Run to execute the current file.<br />
                  <br />
                  <span style={{ color: '#f0a500' }}>🖥 Full interactive terminal coming in Hive Desktop App.</span>
                </span>
              )}
              {runOutput && (
                <>
                  {runOutput.stdout && (
                    <pre style={{ color: '#e6edf3', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{runOutput.stdout}</pre>
                  )}
                  {runOutput.stderr && (
                    <pre style={{ color: runOutput.exit_code === 0 ? '#7d8590' : '#f85149', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{runOutput.stderr}</pre>
                  )}
                  <div style={{ marginTop: 6, color: runOutput.exit_code === 0 ? '#3fb950' : '#f85149', fontSize: 11 }}>
                    {runOutput.exit_code === 0 ? '✓ Process exited successfully' : `✗ Process exited with code ${runOutput.exit_code}`}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Right: Chat panel ─────────────────────────────────────── */}
      <div style={{ width: 360, background: 'var(--bg1)', borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        {/* Chat header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: connected ? 'var(--green)' : 'var(--red)' }} />
            <span style={{ fontWeight: 700, fontSize: 14 }}># {project?.name || '...'}</span>
          </div>
          <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{connected ? 'live' : 'offline'}</span>
        </div>

        {/* ── No API key banner ── shown when user tries @agent without a key */}
        {noKeyBanner && (
          <div style={{ background: '#f0a50015', borderBottom: '1px solid #f0a50040', padding: '10px 14px', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <span style={{ fontSize: 16, flexShrink: 0 }}>⚠️</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--amber)', marginBottom: 3 }}>
                  No {noKeyBanner.provider.charAt(0).toUpperCase() + noKeyBanner.provider.slice(1)} API key
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  The agent needs your API key to run. Get a free key at{' '}
                  <a href={noKeyBanner.key_url} target="_blank" rel="noopener noreferrer"
                     style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>
                    {noKeyBanner.key_url.replace('https://', '')}
                  </a>
                  {' '}then save it in{' '}
                  <button
                    onClick={() => navigate('/profile')}
                    style={{ background: 'none', border: 'none', padding: 0, color: 'var(--accent)', fontWeight: 600, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}
                  >
                    Profile → API Keys →
                  </button>
                </div>
              </div>
              <button
                onClick={() => setNoKeyBanner(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', padding: 0, flexShrink: 0 }}
              >
                <X size={13} />
              </button>
            </div>
          </div>
        )}

        {/* Messages */}
        <div style={{ flex: 1, overflow: 'auto', padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {messages.length === 0 && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--text-dim)', textAlign: 'center', padding: 24 }}>
              <span style={{ fontSize: 36 }}>⬡</span>
              <p style={{ fontSize: 13 }}>Start coding together.<br />Use <code style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>@agent</code> to invoke AI.</p>
            </div>
          )}

          {messages.map(msg => {
            if (msg.type === 'system') {
              return <div key={msg.id} style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', padding: '2px 0' }}>{msg.content}</div>
            }

            // ── Agent error message ────────────────────────────────
            if (msg.type === 'agent_error') {
              return (
                <div key={msg.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <div style={{ width: 26, height: 26, borderRadius: 7, background: '#ef444422', border: '1px solid #ef444444', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                    <Bot size={13} color="#ef4444" />
                  </div>
                  <div style={{ flex: 1, background: '#ef444411', border: '1px solid #ef444433', borderRadius: 7, padding: '8px 12px' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#ef4444', marginBottom: 4 }}>Agent Error</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>{msg.content}</div>
                  </div>
                </div>
              )
            }

            // ── Plan message: show AgentSteps ─────────────────────
            if (msg._planMsg) {
              const { job_id, goal, username, avatarColor } = msg._planMsg
              const liveJob = activeJobs[job_id]
              const steps   = liveJob ? liveJob.steps : msg._planMsg.steps
              return (
                <AgentSteps
                  key={msg.id}
                  goal={goal}
                  steps={steps}
                  username={username}
                  avatarColor={avatarColor}
                  onReviewDiff={diffId => { setReviewDiffId(diffId); setShowDiffPanel(true) }}
                />
              )
            }

            const isMe   = msg.author_id === user?.id
            const member = project?.members.find(m => m.username === msg.author_name.replace("'s Agent", ''))
            const color  = msg.avatar_color || member?.avatar_color || '#6366f1'

            return (
              <div key={msg.id} style={{ display: 'flex', gap: 8 }}>
                {msg.is_agent ? (
                  <div style={{ width: 26, height: 26, borderRadius: 7, background: color + '22', border: `1px solid ${color}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                    <Bot size={13} color={color} />
                  </div>
                ) : (
                  <div style={{ width: 26, height: 26, borderRadius: '50%', background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0, marginTop: 1 }}>
                    {msg.author_name[0]?.toUpperCase()}
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: msg.is_agent ? 'var(--purple)' : color }}>{msg.author_name}</span>
                    {msg.is_agent && msg.agent_model && <span className="tag tag-purple" style={{ fontSize: 10 }}>{modelName(msg.agent_model, models)}</span>}
                    <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginLeft: 'auto' }}>{formatTime(msg.timestamp)}</span>
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', ...(msg.is_agent ? { background: 'var(--bg2)', border: '1px solid #bc8cff22', borderRadius: 7, padding: '8px 12px' } : {}) }}>
                    {msg.content}
                  </div>
                </div>
              </div>
            )
          })}

          {agentTyping && (
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ width: 26, height: 26, borderRadius: 7, background: 'var(--accent-dim)', border: '1px solid var(--accent)44', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Bot size={13} color="var(--purple)" />
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--purple)', marginBottom: 3 }}>{agentTyping.username}'s Agent</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '6px 0' }}>
                  <span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" />
                </div>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Chat input */}
        <div style={{ display: 'flex', flexDirection: 'column', borderTop: '1px solid var(--border)', background: 'var(--bg1)', flexShrink: 0 }}>
          {/* Quick-action strip when no-key banner is visible */}
          {noKeyBanner && (
            <div style={{ padding: '6px 12px 0' }}>
              <button
                onClick={() => navigate('/profile')}
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '7px 12px', background: 'var(--accent)', border: 'none', borderRadius: 7, color: '#000', fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font-display)' }}
              >
                <Zap size={13} /> Add API Key in Profile →
              </button>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, padding: 12 }}>
            <button
              style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent)44', borderRadius: 7, padding: '8px', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              title="Invoke agent"
              onClick={() => { setInput(p => p + '@agent '); inputRef.current?.focus() }}
            >
              <Zap size={14} color="var(--accent)" />
            </button>
            <textarea
              ref={inputRef}
              style={{ flex: 1, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 7, padding: '8px 12px', color: 'var(--text)', fontSize: 13, resize: 'none', outline: 'none', fontFamily: 'var(--font-display)', lineHeight: 1.5, maxHeight: 140, transition: 'border-color 0.15s' }}
              placeholder={`Message or @agent create file.py...`}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              rows={1}
            />
            <button
              style={{ background: 'var(--accent)', border: 'none', borderRadius: 7, padding: '8px 10px', cursor: 'pointer', color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, opacity: input.trim() ? 1 : 0.4 }}
              onClick={sendMessage}
              disabled={!input.trim() || !connected}
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      </div>

    </div>
  )
}