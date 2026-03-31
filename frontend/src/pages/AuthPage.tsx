import React, { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Bot, Users, Globe, Code2, Zap, Trophy, ArrowRight, Shield, CreditCard, Sparkles, Mail, CheckCircle } from 'lucide-react'
import api from '../lib/api'
import { useAuthStore } from '../lib/store'
import {
  signUpWithEmail,
  signInWithEmail,
  sendPasswordResetEmail,
  resendConfirmationEmail,
  onAuthStateChange,
  getAccessToken,
  supabase,
} from '../lib/supabase'

const FEATURES = [
  { icon: <Bot size={16} />, color: '#2dd4bf', title: 'AI Agents per Member', desc: 'Every teammate gets their own AI agent. Type @agent to invoke.' },
  { icon: <Users size={16} />, color: '#60a5fa', title: 'Real-time Collaboration', desc: 'Chat, code, and build together with your whole team live.' },
  { icon: <Globe size={16} />, color: '#a78bfa', title: 'Open Forum', desc: 'Public AI workspaces. Watch others build live, request to join.' },
  { icon: <Trophy size={16} />, color: '#fbbf24', title: 'Hackathons', desc: 'Host and participate in online hackathons with AI-powered teams.' },
  { icon: <Code2 size={16} />, color: '#34d399', title: 'Shared Code Editor', desc: 'Monaco editor with AI diffs, version history and file limits.' },
  { icon: <Zap size={16} />, color: '#f472b6', title: 'BYOK Support', desc: 'Use GPT-4o, Claude, Gemini or local Ollama with your own keys.' },
]

export default function AuthPage() {
  const [mode, setMode]         = useState<'login' | 'signup' | 'confirm' | 'forgot' | 'reset'>('login')
  const [email, setEmail]       = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError]       = useState('')
  const [message, setMessage]   = useState('')
  const [loading, setLoading]   = useState(false)
  const [showForgot, setShowForgot] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotSent, setForgotSent] = useState(false)
  const [forgotLoading, setForgotLoading] = useState(false)
  const [resendLoading, setResendLoading] = useState(false)
  const { setAuth } = useAuthStore()
  const navigate    = useNavigate()
  const [searchParams] = useSearchParams()

  // Safety timeout: reset loading if stuck for too long
  useEffect(() => {
    if (!loading) return
    const timeout = setTimeout(() => {
      setLoading(false)
      setError('Request timed out. Please try again.')
    }, 30000) // 30 second safety timeout
    return () => clearTimeout(timeout)
  }, [loading])

  // Handle OAuth callback and password reset tokens
  useEffect(() => {
    const hash = window.location.hash
    const access_token = searchParams.get('access_token')
    const type = searchParams.get('type')
    const error_description = searchParams.get('error_description')

    // Handle OAuth errors
    if (error_description) {
      setError(decodeURIComponent(error_description))
      return
    }

    // Handle password reset flow
    if (hash && hash.includes('type=recovery')) {
      setMode('reset')
      return
    }

    // Set up auth state listener
    const subscription = onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session) {
        // Get access token and sync user with backend
        const token = await getAccessToken()
        if (token) {
          await syncUserWithBackend(token, session.user.email || '', username)
        }
      } else if (event === 'SIGNED_OUT') {
        // Clear local storage and state
        localStorage.removeItem('yantrik_token')
      } else if (event === 'USER_UPDATED') {
        // Handle email confirmation
        if (session?.user?.email_confirmed_at) {
          const token = await getAccessToken()
          if (token) {
            await syncUserWithBackend(token, session.user.email || '', username)
          }
        }
      }
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [searchParams])

  // Sync user with backend
  async function syncUserWithBackend(token: string, userEmail: string, userUsername: string) {
    try {
      // Call backend to get or create user
      const { data } = await api.post('/auth/supabase', {
        access_token: token,
        email: userEmail,
        username: userUsername || undefined,
      })
      setAuth(data.user, data.token)
      navigate('/')
    } catch (err: any) {
      const errorMsg = err.response?.data?.detail || err.message || 'Failed to sync with server'
      if (errorMsg.includes('Method Not Allowed') || err.response?.status === 405) {
        setError('Server configuration error (405). Please refresh the page and try again.')
      } else if (err.response?.status === 500) {
        setError('Server error. Please try again later.')
      } else {
        setError(errorMsg)
      }
      throw err // Re-throw so caller can handle loading state
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setMessage('')
    setLoading(true)

    try {
      if (mode === 'signup') {
        // Validate password match
        if (password !== confirmPassword) {
          setError('Passwords do not match')
          setLoading(false)
          return
        }

        // Sign up with Supabase (sends confirmation email)
        const { data, error: signUpError } = await signUpWithEmail(email, password, username)

        if (signUpError) {
          const errorMsg = signUpError.message
          if (errorMsg.includes('rate limit') || errorMsg.includes('Rate limit')) {
            setError('Rate limit exceeded. Please wait a few minutes before trying again.')
          } else if (errorMsg.includes('already registered')) {
            setError('This email is already registered. Please sign in instead.')
          } else {
            setError(errorMsg)
          }
          setLoading(false)
          return
        }

        if (data.session) {
          // Auto-confirmed (dev mode) - sync with backend
          const token = await getAccessToken()
          if (token) {
            await syncUserWithBackend(token, email, username)
          } else {
            setError('Failed to get access token. Please try again.')
          }
          setLoading(false)
        } else {
          // Show confirmation message
          setMode('confirm')
          setMessage('Check your email! We\'ve sent a confirmation link to ' + email)
          setLoading(false)
        }
      } else if (mode === 'login') {
        // Sign in with Supabase
        const { data, error: signInError } = await signInWithEmail(email, password)

        if (signInError) {
          const errorMsg = signInError.message
          if (errorMsg.includes('Email not confirmed')) {
            setError('Please confirm your email before signing in. Check your inbox!')
          } else if (errorMsg.includes('rate limit') || errorMsg.includes('Rate limit')) {
            setError('Rate limit exceeded. Please wait a few minutes before trying again.')
          } else if (errorMsg.includes('Invalid login credentials')) {
            setError('Invalid email or password. Please try again.')
          } else {
            setError(errorMsg)
          }
          setLoading(false)
          return
        }

        if (data.session) {
          try {
            const token = await getAccessToken()
            if (token) {
              await syncUserWithBackend(token, email, '')
            } else {
              setError('Failed to get access token. Please try again.')
            }
          } catch (syncErr: any) {
            setError(syncErr.message || 'Failed to sync with server')
          } finally {
            setLoading(false)
          }
        } else {
          setError('Login failed. No session created.')
          setLoading(false)
        }
      } else if (mode === 'reset') {
        // Update password after recovery
        if (password !== confirmPassword) {
          setError('Passwords do not match')
          setLoading(false)
          return
        }

        const { error: updateError } = await supabase.auth.updateUser({
          password: password
        })

        if (updateError) {
          setError(updateError.message)
        } else {
          setMessage('Password updated successfully! You can now sign in.')
          setMode('login')
          setPassword('')
          setConfirmPassword('')
        }
      }
    } catch (err: any) {
      setError(err.message || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault()
    setForgotLoading(true)
    try {
      const { error } = await sendPasswordResetEmail(forgotEmail)
      if (error) {
        const errorMsg = error.message
        if (errorMsg.includes('rate limit') || errorMsg.includes('Rate limit')) {
          setError('Rate limit exceeded. Please wait a few minutes before trying again.')
        } else {
          setError(errorMsg)
        }
      } else {
        setForgotSent(true)
        setMessage('Password reset link sent! Check your email.')
      }
    } catch (err: any) {
      setError(err.message || 'Failed to send reset email')
    } finally {
      setForgotLoading(false)
    }
  }

  async function handleResendConfirmation() {
    setResendLoading(true)
    try {
      const { error } = await resendConfirmationEmail(email)
      if (error) {
        const errorMsg = error.message
        if (errorMsg.includes('rate limit') || errorMsg.includes('Rate limit')) {
          setError('Rate limit exceeded. Please wait a few minutes before trying again.')
        } else {
          setError(errorMsg)
        }
      } else {
        setMessage('Confirmation email resent! Check your inbox.')
      }
    } catch (err: any) {
      setError(err.message || 'Failed to resend email')
    } finally {
      setResendLoading(false)
    }
  }

  // Confirmation screen
  if (mode === 'confirm') {
    return (
      <div style={S.root}>
        <div style={S.gridBg} />
        <div style={S.gradientOrb1} />
        <div style={S.gradientOrb2} />

        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
          <div style={{ ...S.formCard, maxWidth: 420, width: '100%', textAlign: 'center' }}>
            <div style={{ width: 64, height: 64, borderRadius: 16, background: 'var(--teal-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
              <Mail size={32} color="var(--teal)" />
            </div>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>Verify your email</h2>
            <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 20 }}>
              {message}
            </p>
            <p style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 24 }}>
              Didn\'t receive it? Check your spam folder or:
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
              <button
                className="btn btn-ghost"
                onClick={() => setMode('login')}
              >
                Back to Sign In
              </button>
              <button
                className="btn btn-primary"
                onClick={handleResendConfirmation}
                disabled={resendLoading}
              >
                {resendLoading ? 'Sending...' : 'Resend Email'}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={S.root}>
      {/* Background effects */}
      <div style={S.gridBg} />
      <div style={S.gradientOrb1} />
      <div style={S.gradientOrb2} />

      {/* Nav */}
      <nav style={S.nav}>
        <div style={S.navLogo}>
          <div style={S.navLogoIcon}>
            <img src="/logo.png" width="22" height="22" style={{ objectFit: 'contain' }} alt="Yantrik" />
          </div>
          <span style={{ fontWeight: 800, fontSize: 17, letterSpacing: '-0.04em', color: 'var(--text)' }}>Yantrik</span>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button style={S.navBtn} onClick={() => setMode('login')}>Sign In</button>
          <button className="btn btn-primary" style={{ padding: '7px 16px', fontSize: 12 }} onClick={() => setMode('signup')}>
            Get Started <ArrowRight size={13} />
          </button>
        </div>
      </nav>

      {/* Main layout */}
      <div style={S.layout}>
        {/* Left: Hero */}
        <div style={S.hero}>
          <div style={S.logoWrap}>
            <div style={S.logoIcon}>
              <img src="/logo.png" width="44" height="44" style={{ objectFit: 'contain' }} alt="Yantrik" />
            </div>
            <div>
              <div style={S.logoName}>Yantrik</div>
              <div style={S.logoTagline}>Collaborative AI Coding for Teams</div>
            </div>
          </div>

          <h1 style={S.heroTitle}>
            Build faster with<br />
            <span style={S.heroAccent}>AI teammates</span>
          </h1>
          <p style={S.heroSub}>
            Every developer on your team gets their own AI agent. Chat, code, and ship together in real-time — all in one workspace.
          </p>

          <div style={S.stats}>
            {[['Free forever', 'Groq models'], ['₹25/mo', 'GPT-4o, Claude, Gemini'], ['Open source', 'MIT licensed']].map(([v, l]) => (
              <div key={v} style={S.stat}>
                <div style={S.statVal}>{v}</div>
                <div style={S.statLabel}>{l}</div>
              </div>
            ))}
          </div>

          <div style={S.features}>
            {FEATURES.map((f, i) => (
              <div key={f.title} style={{ ...S.feature, animationDelay: `${i * 0.06}s` }}>
                <div style={{ ...S.featureIcon, background: `${f.color}0a`, border: `1px solid ${f.color}18`, color: f.color }}>
                  {f.icon}
                </div>
                <div>
                  <div style={S.featureTitle}>{f.title}</div>
                  <div style={S.featureDesc}>{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Form */}
        <div style={S.formWrap}>
          <div style={S.formCard}>
            {/* Header */}
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>
                {mode === 'reset' ? 'Reset Password' : mode === 'signup' ? 'Create Account' : 'Sign In'}
              </h2>
              <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                {mode === 'reset'
                  ? 'Enter your new password below'
                  : mode === 'signup'
                    ? 'Get started with your free account'
                    : 'Welcome back! Sign in to continue'}
              </p>
            </div>

            {/* Success/Info Message */}
            {message && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '12px 14px',
                background: 'var(--green-dim)',
                border: '1px solid var(--green)',
                borderRadius: 8,
                marginBottom: 16,
                fontSize: 13,
                color: 'var(--green)'
              }}>
                <CheckCircle size={16} />
                {message}
              </div>
            )}

            {/* Error */}
            {error && (
              <div style={{
                padding: '12px 14px',
                background: 'var(--red-dim)',
                border: '1px solid var(--red)',
                borderRadius: 8,
                marginBottom: 16,
                fontSize: 13,
                color: 'var(--red)',
                lineHeight: 1.5
              }}>
                {error}
              </div>
            )}

            {/* Form */}
            <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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
                  onChange={e => setEmail(e.target.value)} required disabled={mode === 'reset'} />
              </div>
              <div>
                <label style={S.label}>Password</label>
                <input className="input" type="password" placeholder="••••••••" value={password}
                  onChange={e => setPassword(e.target.value)} required minLength={6} />
              </div>
              {(mode === 'signup' || mode === 'reset') && (
                <div>
                  <label style={S.label}>Confirm Password</label>
                  <input className="input" type="password" placeholder="••••••••" value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)} required minLength={6} />
                </div>
              )}
              {mode === 'login' && (
                <button type="button" onClick={() => setShowForgot(true)}
                  style={{ fontSize: 11, color: 'var(--teal)', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'right', fontFamily: 'var(--mono)', padding: 0, opacity: 0.8, transition: 'opacity 0.15s' }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = '1'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity = '0.8'}>
                  Forgot password?
                </button>
              )}
              <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '11px 0', fontSize: 14 }} disabled={loading}>
                {loading
                  ? 'Loading...'
                  : mode === 'reset'
                    ? 'Update Password'
                    : mode === 'signup'
                      ? 'Create Account'
                      : 'Sign In'}
              </button>
            </form>

            {/* Mode switcher */}
            {mode !== 'reset' && (
              <div style={{ textAlign: 'center', marginTop: 18, paddingTop: 18, borderTop: '1px solid var(--border)' }}>
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  {mode === 'login' ? "Don't have an account? " : "Already have an account? "}
                </span>
                <button
                  style={{
                    fontSize: 13,
                    color: 'var(--teal)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontWeight: 600
                  }}
                  onClick={() => {
                    setMode(mode === 'login' ? 'signup' : 'login')
                    setError('')
                    setMessage('')
                  }}
                >
                  {mode === 'login' ? 'Sign up' : 'Sign in'}
                </button>
              </div>
            )}

            {/* Trust badges */}
            <div style={S.trust}>
              {[
                [<Shield size={11} key="s" />, 'AES-256 encrypted'],
                [<Sparkles size={11} key="z" />, 'Free tier forever'],
                [<CreditCard size={11} key="c" />, 'No credit card'],
              ].map(([icon, text], i) => (
                <div key={i} style={S.trustItem}>{icon}<span>{text as string}</span></div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Forgot password modal */}
      {showForgot && (
        <div style={S.overlay} onClick={() => setShowForgot(false)}>
          <div className="card" style={S.modal} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>Reset Password</h2>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 18, lineHeight: 1.5 }}>
              Enter your email and we\'ll send a reset link.
            </p>
            {forgotSent ? (
              <div style={{ textAlign: 'center', padding: 24 }}>
                <div style={{ fontSize: 36, marginBottom: 14 }}>✉️</div>
                <p style={{ color: 'var(--green)', fontWeight: 600, fontSize: 14 }}>{message}</p>
              </div>
            ) : (
              <form onSubmit={handleForgotPassword} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <input className="input" type="email" placeholder="you@example.com" value={forgotEmail}
                  onChange={e => setForgotEmail(e.target.value)} required autoFocus />
                {error && (
                  <p style={{ color: 'var(--red)', fontSize: 12 }}>{error}</p>
                )}
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                  <button type="button" className="btn btn-ghost" onClick={() => setShowForgot(false)}>Cancel</button>
                  <button className="btn btn-primary" disabled={forgotLoading}>
                    {forgotLoading ? 'Sending...' : 'Send Reset Link'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  root: { minHeight: '100vh', background: 'var(--bg)', position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' },
  gridBg: { position: 'fixed', inset: 0, backgroundImage: 'linear-gradient(rgba(28,32,48,0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(28,32,48,0.2) 1px, transparent 1px)', backgroundSize: '52px 52px', maskImage: 'radial-gradient(ellipse 70% 60% at 50% 0%, black 20%, transparent 100%)', opacity: 0.5, pointerEvents: 'none' },
  gradientOrb1: { position: 'fixed', top: '-20%', left: '0%', width: 700, height: 700, borderRadius: '50%', background: 'radial-gradient(circle, rgba(45,212,191,0.06) 0%, transparent 65%)', pointerEvents: 'none', filter: 'blur(40px)' },
  gradientOrb2: { position: 'fixed', bottom: '-30%', right: '-5%', width: 800, height: 800, borderRadius: '50%', background: 'radial-gradient(circle, rgba(96,165,250,0.04) 0%, transparent 65%)', pointerEvents: 'none', filter: 'blur(40px)' },

  nav: { position: 'relative', zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 40px', background: 'rgba(9,11,15,0.5)', backdropFilter: 'blur(20px)', borderBottom: '1px solid var(--glass-border)' },
  navLogo: { display: 'flex', alignItems: 'center', gap: 9 },
  navLogoIcon: { width: 32, height: 32, borderRadius: 9, overflow: 'hidden', background: 'var(--bg1)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border)', flexShrink: 0 },
  navBtn: { background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 13, fontWeight: 500, cursor: 'pointer', padding: '7px 14px', borderRadius: 7, fontFamily: 'var(--font)', transition: 'color 0.15s' },

  layout: { flex: 1, display: 'flex', alignItems: 'stretch', maxWidth: 1200, margin: '0 auto', width: '100%', padding: '0 40px 48px', gap: 64, position: 'relative', zIndex: 1 },

  hero: { flex: 1, display: 'flex', flexDirection: 'column', gap: 28, paddingTop: 56 },
  logoWrap: { display: 'flex', alignItems: 'center', gap: 16 },
  logoIcon: { width: 60, height: 60, borderRadius: 16, overflow: 'hidden', background: 'var(--bg1)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: 'var(--shadow-glow)', animation: 'float 6s ease-in-out infinite' },
  logoName: { fontSize: 32, fontWeight: 900, letterSpacing: '-0.05em', lineHeight: 1 },
  logoTagline: { fontSize: 12, color: 'var(--text-dim)', marginTop: 4, fontFamily: 'var(--mono)', letterSpacing: '0.02em' },

  heroTitle: { fontSize: 46, fontWeight: 900, letterSpacing: '-0.04em', lineHeight: 1.05, animation: 'fadeUp 0.5s ease-out forwards' },
  heroAccent: { background: 'linear-gradient(135deg, var(--teal), var(--blue), var(--purple))', backgroundSize: '200% 200%', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', animation: 'shimmer 5s ease infinite' },
  heroSub: { fontSize: 15, color: 'var(--text-muted)', lineHeight: 1.7, maxWidth: 480, animation: 'fadeUp 0.5s 0.08s ease-out forwards', opacity: 0 },

  stats: { display: 'flex', gap: 28 },
  stat: { display: 'flex', flexDirection: 'column', gap: 2 },
  statVal: { fontSize: 15, fontWeight: 800, color: 'var(--teal)' },
  statLabel: { fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--mono)' },

  features: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 },
  feature: { display: 'flex', alignItems: 'flex-start', gap: 10, animation: 'fadeUp 0.4s ease-out forwards', opacity: 0 },
  featureIcon: { width: 34, height: 34, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  featureTitle: { fontSize: 12, fontWeight: 700, marginBottom: 2, letterSpacing: '-0.01em' },
  featureDesc: { fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.45 },

  formWrap: { width: 380, display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingTop: 36, flexShrink: 0 },
  formCard: { background: 'var(--glass)', backdropFilter: 'blur(32px)', border: '1px solid var(--glass-border)', borderRadius: 16, padding: 28, boxShadow: 'var(--shadow-lg), inset 0 1px 0 rgba(255,255,255,0.03)', animation: 'fadeUp 0.4s 0.1s ease-out forwards', opacity: 0 },

  orRow: { display: 'flex', alignItems: 'center', margin: '12px 0' },

  label: { display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' as const, letterSpacing: '0.07em', fontFamily: 'var(--mono)', marginBottom: 6 },

  trust: { display: 'flex', justifyContent: 'center', gap: 18, marginTop: 20, paddingTop: 18, borderTop: '1px solid var(--border)' },
  trustItem: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--mono)' },

  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(12px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, animation: 'fadeIn 0.15s ease-out' },
  modal: { width: '100%', maxWidth: 420, padding: 28, animation: 'scaleIn 0.2s ease-out' },
}
