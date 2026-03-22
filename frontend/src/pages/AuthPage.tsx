import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bot, Users, Globe, Code2, Zap, Trophy, ChevronRight, Check } from 'lucide-react'
import api from '../lib/api'
import { useAuthStore } from '../lib/store'

const FEATURES = [
  { icon: <Bot size={18} color="#2dd4bf" />, title: 'AI Agents per Member', desc: 'Every teammate gets their own AI agent. Type @agent to invoke.' },
  { icon: <Users size={18} color="#60a5fa" />, title: 'Real-time Collaboration', desc: 'Chat, code, and build together with your whole team live.' },
  { icon: <Globe size={18} color="#a78bfa" />, title: 'Open Forum', desc: 'Public AI workspaces. Watch others build live, request to join.' },
  { icon: <Trophy size={18} color="#fbbf24" />, title: 'Hackathons', desc: 'Host and participate in online hackathons with AI-powered teams.' },
  { icon: <Code2 size={18} color="#34d399" />, title: 'Shared Code Editor', desc: 'Monaco editor with AI diffs, version history and file limits.' },
  { icon: <Zap size={18} color="#f472b6" />, title: 'BYOK Support', desc: 'Use GPT-4o, Claude, Gemini or local Ollama with your own keys.' },
]

export default function AuthPage() {
  const [mode, setMode]         = useState<'login' | 'signup'>('login')
  const [email, setEmail]       = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [gLoading, setGLoading] = useState(false)
  const [showForgot, setShowForgot] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotSent, setForgotSent] = useState(false)
  const [forgotLoading, setForgotLoading] = useState(false)
  const { setAuth } = useAuthStore()
  const navigate    = useNavigate()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      const endpoint = mode === 'login' ? '/auth/login' : '/auth/signup'
      const payload  = mode === 'login' ? { email, password } : { email, username, password }
      const { data } = await api.post(endpoint, payload)
      setAuth(data.user, data.token)
      navigate('/')
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Something went wrong')
    } finally { setLoading(false) }
  }

  async function handleGoogle() {
    setError(''); setGLoading(true)
    try {
      const { signInWithGoogle } = await import('../lib/firebase')
      const idToken = await signInWithGoogle()
      const { data } = await api.post('/auth/google', { id_token: idToken })
      setAuth(data.user, data.token)
      navigate('/')
    } catch (err: any) {
      if (err.code === 'auth/popup-closed-by-user') { setGLoading(false); return }
      setError(err.response?.data?.detail || err.message || 'Google sign-in failed')
    } finally { setGLoading(false) }
  }

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault()
    setForgotLoading(true)
    try {
      const { sendPasswordResetEmail } = await import('../lib/firebase')
      await sendPasswordResetEmail(forgotEmail)
      setForgotSent(true)
    } catch (err: any) {
      setError(err.message || 'Failed to send reset email')
    } finally {
      setForgotLoading(false)
    }
  }

  return (
    <div style={S.root}>
      {/* Animated grid background */}
      <div style={S.gridBg} />
      {/* Glow blobs */}
      <div style={S.blob1} />
      <div style={S.blob2} />

      {/* ── Top navbar ────────────────────────────────────────────── */}
      <nav style={S.nav} className="auth-nav">
        <div style={S.navLogo}>
          <div style={S.navLogoIcon}>
            <img src="/logo.png" width="22" height="22" style={{ objectFit: 'cover', borderRadius: 4 }} alt="Yantrik" />
          </div>
          <span style={{ fontWeight: 800, fontSize: 18, letterSpacing: '-0.03em' }}>Yantrik</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button style={S.navBtn} onClick={() => setMode('login')}>Sign In</button>
          <button className="btn btn-primary" style={{ padding: '7px 16px', fontSize: 13 }} onClick={() => setMode('signup')}>
            Get Started →
          </button>
        </div>
      </nav>

      {/* ── Main layout ───────────────────────────────────────────── */}
      <div style={S.layout} className="auth-layout">

        {/* ── Left: Hero + features ──────────────────────────────── */}
        <div style={S.hero} className="auth-hero">
          {/* Logo */}
          <div style={S.logoWrap}>
            <div style={S.logoIcon}>
              <img src="/logo.png" width="44" height="44" style={{ objectFit: 'cover', borderRadius: 10 }} alt="Yantrik" />
            </div>
            <div>
              <div style={S.logoName} className="auth-logo-name">Yantrik</div>
              <div style={S.logoTagline}>Collaborative AI Coding for Teams</div>
            </div>
          </div>

          {/* Hero text */}
          <h1 style={S.heroTitle} className="auth-hero-title">
            Build faster with<br />
            <span style={S.heroAccent}>AI teammates</span>
          </h1>
          <p style={S.heroSub}>
            Every developer on your team gets their own AI agent. Chat, code, and ship together in real-time — all in one workspace.
          </p>

          {/* Stats */}
          <div style={S.stats} className="auth-stats">
            {[['Free forever', 'Groq models'], ['₹25/mo', 'GPT-4o, Claude, Gemini'], ['Open source', 'MIT licensed']].map(([v, l]) => (
              <div key={v} style={S.stat}>
                <div style={S.statVal}>{v}</div>
                <div style={S.statLabel}>{l}</div>
              </div>
            ))}
          </div>

          {/* Features grid */}
          <div style={S.features} className="auth-features">
            {FEATURES.map(f => (
              <div key={f.title} style={S.feature}>
                <div style={S.featureIcon}>{f.icon}</div>
                <div>
                  <div style={S.featureTitle}>{f.title}</div>
                  <div style={S.featureDesc}>{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Right: Auth form ───────────────────────────────────── */}
        <div style={S.formWrap} className="auth-form-wrap">
          <div style={S.formCard}>
            {/* Tabs */}
            <div style={S.tabs}>
              {(['login', 'signup'] as const).map(m => (
                <button key={m} onClick={() => setMode(m)}
                  style={{ ...S.tab, ...(mode === m ? S.tabActive : {}) }}>
                  {m === 'login' ? 'Sign In' : 'Create Account'}
                </button>
              ))}
            </div>

            {/* Google */}
            <button style={S.googleBtn} onClick={handleGoogle} disabled={gLoading}>
              {gLoading ? <span style={{ opacity: 0.6 }}>Signing in...</span> : (
                <>
                  <svg width="17" height="17" viewBox="0 0 48 48">
                    <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.2l6.7-6.7C35.8 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.8 6.1C12.4 13.2 17.7 9.5 24 9.5z"/>
                    <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.1 7-17.1z"/>
                    <path fill="#FBBC05" d="M10.5 28.6A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.6l-7.8-6.1A23.9 23.9 0 0 0 0 24c0 3.9.9 7.5 2.5 10.7l8-6.1z"/>
                    <path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.2-5.5l-7.6-5.9c-2 1.4-4.7 2.2-7.6 2.2-6.3 0-11.6-3.7-13.5-9l-8 6.1C6.6 42.6 14.6 48 24 48z"/>
                  </svg>
                  Continue with Google
                </>
              )}
            </button>

            <div style={S.orRow}>
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              <span style={{ fontSize: 11, color: 'var(--text-dim)', padding: '0 10px', fontFamily: 'var(--mono)' }}>or</span>
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            </div>

            {/* Form */}
            <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {mode === 'signup' && (
                <div>
                  <label style={S.label}>Username</label>
                  <input className="input" placeholder="your_handle" value={username}
                    onChange={e => setUsername(e.target.value)} required />
                </div>
              )}
              <div>
                <label style={S.label}>Email</label>
                <input className="input" type="email" placeholder="you@example.com" value={email}
                  onChange={e => setEmail(e.target.value)} required />
              </div>
              <div>
                <label style={S.label}>Password</label>
                <input className="input" type="password" placeholder="••••••••" value={password}
                  onChange={e => setPassword(e.target.value)} required minLength={6} />
              </div>
              {mode === 'login' && (
                <button type="button" onClick={() => setShowForgot(true)}
                  style={{ fontSize: 11, color: 'var(--text-dim)', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'right', fontFamily: 'var(--mono)', padding: 0 }}>
                  Forgot password?
                </button>
              )}
              {error && <p style={{ color: 'var(--red)', fontSize: 12, fontFamily: 'var(--mono)' }}>{error}</p>}
              <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 4 }} disabled={loading}>
                {loading ? 'Loading...' : mode === 'login' ? 'Sign In' : 'Create Account'}
              </button>
            </form>

            <p style={{ fontSize: 11, color: 'var(--text-dim)', textAlign: 'center', marginTop: 14, fontFamily: 'var(--mono)' }}>
              Type <code style={{ color: 'var(--teal)', background: 'var(--teal-dim)', padding: '1px 5px', borderRadius: 3 }}>@agent</code> in chat to invoke your AI
            </p>
          </div>

          {/* Trust badges */}
          <div style={S.trust}>
            {['Free to start', 'No credit card', 'Cancel anytime'].map(t => (
              <span key={t} style={S.trustItem}><Check size={11} color="var(--green)" /> {t}</span>
            ))}
          </div>
        </div>
      </div>

      {/* Forgot password modal */}
      {showForgot && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: 'var(--bg1)', border: '1px solid var(--border)', borderRadius: 14, padding: 28, width: '100%', maxWidth: 380 }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Reset Password</h3>
            {forgotSent ? (
              <div>
                <p style={{ color: 'var(--green)', fontSize: 13, marginBottom: 16 }}>✅ Reset email sent! Check your inbox.</p>
                <button className="btn btn-ghost" style={{ width: '100%', justifyContent: 'center' }} onClick={() => { setShowForgot(false); setForgotSent(false) }}>Close</button>
              </div>
            ) : (
              <form onSubmit={handleForgotPassword} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 4 }}>Enter your email and we'll send a reset link.</p>
                <input className="input" type="email" placeholder="you@example.com" value={forgotEmail} onChange={e => setForgotEmail(e.target.value)} required />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="btn btn-ghost" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setShowForgot(false)}>Cancel</button>
                  <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} disabled={forgotLoading}>{forgotLoading ? 'Sending...' : 'Send Reset Link'}</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      <style>{`
        @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-12px)} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
      `}</style>
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  root: {
    minHeight: '100vh', background: 'var(--bg)', position: 'relative',
    overflow: 'hidden', display: 'flex', flexDirection: 'column',
  },
  gridBg: {
    position: 'fixed', inset: 0,
    backgroundImage: 'linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)',
    backgroundSize: '44px 44px',
    maskImage: 'radial-gradient(ellipse 80% 80% at 50% 0%, black 30%, transparent 100%)',
    opacity: 0.35, pointerEvents: 'none',
  },
  blob1: {
    position: 'fixed', top: '-10%', left: '10%', width: 500, height: 500,
    borderRadius: '50%', background: 'radial-gradient(circle, #2dd4bf18 0%, transparent 70%)',
    pointerEvents: 'none',
  },
  blob2: {
    position: 'fixed', bottom: '-20%', right: '5%', width: 600, height: 600,
    borderRadius: '50%', background: 'radial-gradient(circle, #60a5fa12 0%, transparent 70%)',
    pointerEvents: 'none',
  },

  nav: {
    position: 'relative', zIndex: 10, display: 'flex', alignItems: 'center',
    justifyContent: 'space-between', padding: '16px 40px',
    borderBottom: '1px solid var(--border)',
    background: 'rgba(12,14,18,0.8)', backdropFilter: 'blur(12px)',
  },
  navLogo: { display: 'flex', alignItems: 'center', gap: 9 },
  navLogoIcon: {
    width: 32, height: 32, borderRadius: 9, overflow: 'hidden',
    boxShadow: '0 0 14px var(--teal-glow)',
    flexShrink: 0,
  },
  navBtn: {
    background: 'none', border: 'none', color: 'var(--text-muted)',
    fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: '6px 12px',
    borderRadius: 6, fontFamily: 'var(--font)', transition: 'color 0.12s',
  },

  layout: {
    flex: 1, display: 'flex', alignItems: 'stretch',
    maxWidth: 1200, margin: '0 auto', width: '100%', padding: '0 40px 60px',
    gap: 60, position: 'relative', zIndex: 1,
  },

  // Left hero
  hero: { flex: 1, display: 'flex', flexDirection: 'column', gap: 28, paddingTop: 60 },
  logoWrap: { display: 'flex', alignItems: 'center', gap: 16 },
  logoIcon: {
    width: 64, height: 64, borderRadius: 18, overflow: 'hidden',
    boxShadow: '0 0 30px var(--teal-glow), 0 0 60px var(--teal-dim)',
    animation: 'float 4s ease-in-out infinite',
    flexShrink: 0,
  },
  logoName: { fontSize: 32, fontWeight: 900, letterSpacing: '-0.04em' },
  logoTagline: { fontSize: 13, color: 'var(--text-muted)', marginTop: 2 },

  heroTitle: {
    fontSize: 48, fontWeight: 900, letterSpacing: '-0.04em', lineHeight: 1.1,
    animation: 'fadeUp 0.5s ease forwards',
  },
  heroAccent: {
    background: 'linear-gradient(135deg, var(--teal), var(--blue))',
    WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
  },
  heroSub: {
    fontSize: 16, color: 'var(--text-muted)', lineHeight: 1.65, maxWidth: 480,
    animation: 'fadeUp 0.5s 0.1s ease forwards', opacity: 0,
  },

  stats: { display: 'flex', gap: 28 },
  stat:  { display: 'flex', flexDirection: 'column', gap: 2 },
  statVal:   { fontSize: 15, fontWeight: 800, color: 'var(--teal)' },
  statLabel: { fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--mono)' },

  features: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 },
  feature:  { display: 'flex', alignItems: 'flex-start', gap: 10 },
  featureIcon: {
    width: 34, height: 34, borderRadius: 9, background: 'var(--bg2)',
    border: '1px solid var(--border)', display: 'flex', alignItems: 'center',
    justifyContent: 'center', flexShrink: 0,
  },
  featureTitle: { fontSize: 13, fontWeight: 700, marginBottom: 2 },
  featureDesc:  { fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 },

  // Right form
  formWrap: {
    width: 380, display: 'flex', flexDirection: 'column', gap: 12,
    justifyContent: 'center', paddingTop: 40,
  },
  formCard: {
    background: 'var(--bg1)', border: '1px solid var(--border)',
    borderRadius: 14, padding: 28,
    boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
    animation: 'fadeUp 0.4s 0.15s ease forwards', opacity: 0,
  },
  tabs: {
    display: 'flex', gap: 3, background: 'var(--bg)', borderRadius: 8,
    padding: 3, marginBottom: 18,
  },
  tab: {
    flex: 1, padding: '7px 12px', border: 'none', borderRadius: 6,
    background: 'transparent', color: 'var(--text-muted)', fontSize: 12,
    fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font)', transition: 'all 0.12s',
  },
  tabActive: { background: 'var(--bg2)', color: 'var(--text)' },
  googleBtn: {
    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
    gap: 9, padding: '10px 14px', background: 'var(--bg2)',
    border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)',
    fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font)',
    transition: 'border-color 0.15s', marginBottom: 4,
  },
  orRow: { display: 'flex', alignItems: 'center', margin: '8px 0' },
  label: {
    display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
    textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'var(--mono)', marginBottom: 5,
  },

  trust: { display: 'flex', justifyContent: 'center', gap: 20 },
  trustItem: {
    display: 'flex', alignItems: 'center', gap: 5,
    fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--mono)',
  },
}
