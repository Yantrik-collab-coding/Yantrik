import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MessageSquare, Bot, Users, Globe, Zap, Code, Trophy, UserPlus, ChevronDown, ChevronUp } from 'lucide-react'

const sections = [
  {
    icon: <Users size={20} color="var(--accent)" />, title: 'Create a Workspace',
    steps: [
      'Click "+ New Project" on your dashboard',
      'Give it a name and description',
      'Share the invite code with your team',
      'Each member joins using the code and picks their AI model',
    ]
  },
  {
    icon: <Bot size={20} color="var(--purple)" />, title: 'Invoke Your AI Agent',
    steps: [
      'Type any message normally to chat with your team',
      'Type @agent followed by your question to invoke your personal AI',
      'Your agent sees the full conversation history as context',
      'All agents\' responses are visible to everyone in the workspace',
      'Each person\'s agent uses their chosen model (Llama, GPT-4o, Claude etc.)',
    ]
  },
  {
    icon: <Code size={20} color="var(--accent2)" />, title: 'Code Together with AI',
    steps: [
      'Create files in the workspace editor (sidebar → + New File)',
      'Type @agent create a FastAPI endpoint for user auth to generate code',
      'Agent proposes a diff — review it, then Accept or Reject',
      'All accepted changes are visible to your whole team instantly',
      'Full version history is saved — revert any file at any time',
    ]
  },
  {
    icon: <Globe size={20} color="var(--accent2)" />, title: 'Open Forum',
    steps: [
      'Click "Open Forum" in the sidebar to browse public workspaces',
      'Anyone can read and watch public projects in real time',
      'Click "Request to Join" to ask for write access',
      'Project owner approves or rejects — you get notified',
      'Create your own public project to showcase your work',
    ]
  },
  {
    icon: <Trophy size={20} color="var(--accent)" />, title: 'Host a Hackathon',
    steps: [
      'Click "Hackathon" in the top nav → Create Hackathon',
      'Set team count, max members per team, and time window',
      'Add judges by their UID (found in their profile)',
      'Teams register → leaders get a private workspace automatically',
      'Leaders invite members by UID',
      'Judges see all team workspaces, chats and code — teams can\'t see each other',
    ]
  },
  {
    icon: <UserPlus size={20} color="var(--green)" />, title: 'Add Friends',
    steps: [
      'Find your unique UID in Profile (e.g. AB12CD34)',
      'Share your UID with friends',
      'Go to Profile → Friends → Add by UID',
      'They accept your request',
      'Use UIDs to invite friends to teams and hackathons directly',
    ]
  },
  {
    icon: <Zap size={20} color="var(--accent)" />, title: 'BYOK — Use Premium Models',
    steps: [
      'Go to Profile → Plans → Upgrade to BYOK (₹25/mo in India, $2 globally)',
      'After payment, go to Profile → API Keys',
      'Paste your OpenAI / Anthropic / Google key',
      'Your key is AES-256 encrypted — we never see it in plaintext',
      'Switch to GPT-4o, Claude, or Gemini in any workspace',
    ]
  },
]

export default function HowToUsePage() {
  const navigate = useNavigate()
  const [open, setOpen] = useState<number | null>(0)

  return (
    <div style={S.root}>
      <div style={S.bg} />
      <button style={S.back} onClick={() => navigate('/')}>← Back</button>

      <div style={S.hero}>
        <div className="tag tag-green" style={{ fontSize: 12, marginBottom: 16 }}>Documentation</div>
        <h1 style={S.title}>How to use Hive</h1>
        <p style={S.sub}>Everything you need to know to get the most out of collaborative AI</p>
      </div>

      <div style={S.content}>
        {/* Quick start */}
        <div className="card" style={S.quickStart}>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>⚡ 60-second quick start</h2>
          <div style={S.quickSteps}>
            {['Sign up', 'Create a project', 'Invite teammates', 'Type @agent in chat', 'Watch the magic'].map((s, i) => (
              <div key={s} style={S.quickStep}>
                <div style={S.stepNum}>{i + 1}</div>
                <span style={{ fontSize: 13 }}>{s}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Accordions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {sections.map((sec, i) => (
            <div key={sec.title} className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <button
                style={S.accHeader}
                onClick={() => setOpen(open === i ? null : i)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {sec.icon}
                  <span style={{ fontWeight: 700, fontSize: 15 }}>{sec.title}</span>
                </div>
                {open === i ? <ChevronUp size={16} color="var(--text-muted)" /> : <ChevronDown size={16} color="var(--text-muted)" />}
              </button>
              {open === i && (
                <div style={S.accBody}>
                  <ol style={S.stepList}>
                    {sec.steps.map((step, j) => (
                      <li key={j} style={S.stepItem}>
                        <span style={S.stepNumSmall}>{j + 1}</span>
                        <span style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6 }}
                          dangerouslySetInnerHTML={{ __html: step.replace(/@agent/g, '<code style="background:var(--accent-dim);color:var(--accent);padding:1px 5px;border-radius:4px;font-family:var(--font-mono)">@agent</code>') }}
                        />
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Keyboard shortcuts */}
        <div className="card" style={{ padding: 24 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>⌨️ Keyboard Shortcuts</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {[
              ['Enter', 'Send message'],
              ['Shift + Enter', 'New line in message'],
              ['@agent', 'Invoke your AI agent'],
              ['Ctrl+S', 'Save file in editor'],
            ].map(([key, desc]) => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <code style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 8px', fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--accent)', whiteSpace: 'nowrap' }}>{key}</code>
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{desc}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  root: { minHeight: '100vh', background: 'var(--bg)', padding: '48px 40px', position: 'relative' },
  bg: { position: 'fixed', inset: 0, backgroundImage: 'radial-gradient(ellipse 60% 40% at 50% -10%, #3fb95018, transparent)', pointerEvents: 'none' },
  back: { position: 'absolute', top: 24, left: 40, background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 13, fontFamily: 'var(--font-mono)' },
  hero: { textAlign: 'center', marginBottom: 48, paddingTop: 20 },
  title: { fontSize: 44, fontWeight: 800, letterSpacing: '-0.03em', marginBottom: 12 },
  sub: { fontSize: 15, color: 'var(--text-muted)' },
  content: { maxWidth: 780, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 },
  quickStart: { padding: 24 },
  quickSteps: { display: 'flex', alignItems: 'center', gap: 0, flexWrap: 'wrap' },
  quickStep: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: 'var(--bg2)', borderRadius: 8, fontSize: 13, margin: '4px 8px 4px 0' },
  stepNum: { width: 22, height: 22, borderRadius: '50%', background: 'var(--accent)', color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 },
  accHeader: { width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text)', fontFamily: 'var(--font-display)' },
  accBody: { padding: '0 20px 20px', borderTop: '1px solid var(--border)' },
  stepList: { listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 16 },
  stepItem: { display: 'flex', alignItems: 'flex-start', gap: 12 },
  stepNumSmall: { width: 20, height: 20, borderRadius: '50%', background: 'var(--bg3)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0, marginTop: 2 },
}
