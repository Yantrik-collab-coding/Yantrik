import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, LogOut, Key, User, Palette, Check, Zap, Trash2, Eye, EyeOff, ExternalLink, UserPlus, UserCheck, UserX, Copy } from 'lucide-react'
import api from '../lib/api'
import { useAuthStore } from '../lib/store'

const COLORS = [
  '#6366f1','#ec4899','#f59e0b','#10b981',
  '#3b82f6','#8b5cf6','#ef4444','#14b8a6',
  '#f97316','#84cc16','#06b6d4','#a855f7',
]

interface PlanInfo { display: string; amount: number }
interface BillingStatus {
  byok_enabled: boolean
  ollama_enabled: boolean
  country: string
  gateway: 'razorpay' | 'stripe'
  currency: string
  symbol: string
  razorpay_key_id: string | null
  stripe_pub_key: string | null
  plans: { byok: PlanInfo; ollama: PlanInfo }
}
interface SavedKey { provider: string; updated_at: string }
declare global { interface Window { Razorpay: any } }

export default function ProfilePage() {
  const { user, setAuth, logout, token } = useAuthStore()
  const navigate = useNavigate()

  const [selectedColor, setSelectedColor] = useState(user?.avatar_color || '#6366f1')
  const [colorSaved,    setColorSaved]    = useState(false)
  const [currentPw,   setCurrentPw]   = useState('')
  const [newPw,        setNewPw]       = useState('')
  const [confirmPw,   setConfirmPw]   = useState('')
  const [pwLoading,   setPwLoading]   = useState(false)
  const [pwError,     setPwError]     = useState('')
  const [pwSuccess,   setPwSuccess]   = useState(false)
  const [billing,     setBilling]     = useState<BillingStatus | null>(null)
  const [payLoading,  setPayLoading]  = useState<string | null>(null)
  const [cancelLoading, setCancelLoading] = useState(false)
  const [savedKeys,   setSavedKeys]   = useState<SavedKey[]>([])
  const [keyInputs,   setKeyInputs]   = useState<Record<string, string>>({})
  const [showKey,     setShowKey]     = useState<Record<string, boolean>>({})
  const [keySaving,   setKeySaving]   = useState<string | null>(null)
  const [keySuccess,  setKeySuccess]  = useState<string | null>(null)
  const [friends,     setFriends]     = useState<any[]>([])
  const [friendReqs,  setFriendReqs]  = useState<any[]>([])
  const [addUid,      setAddUid]      = useState('')
  const [addResult,   setAddResult]   = useState('')
  const [addLoading,  setAddLoading]  = useState(false)

  useEffect(() => {
    api.get('/billing/status').then(r => setBilling(r.data)).catch(() => {})
    api.get('/billing/keys').then(r => setSavedKeys(r.data.keys)).catch(() => {})
    // Load Razorpay script
    if (!document.getElementById('rzp-script')) {
      const s = document.createElement('script')
      s.id = 'rzp-script'
      s.src = 'https://checkout.razorpay.com/v1/checkout.js'
      document.body.appendChild(s)
    }
  }, [])

  async function saveColor() {
    await api.patch('/auth/avatar-color', { color: selectedColor })
    if (user && token) setAuth({ ...user, avatar_color: selectedColor }, token)
    setColorSaved(true); setTimeout(() => setColorSaved(false), 2000)
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault(); setPwError('')
    if (newPw !== confirmPw) { setPwError("Passwords don't match"); return }
    if (newPw.length < 6)   { setPwError('Min 6 characters'); return }
    setPwLoading(true)
    try {
      await api.post('/auth/change-password', { current_password: currentPw, new_password: newPw })
      setPwSuccess(true); setCurrentPw(''); setNewPw(''); setConfirmPw('')
      setTimeout(() => setPwSuccess(false), 3000)
    } catch (err: any) { setPwError(err.response?.data?.detail || 'Failed') }
    finally { setPwLoading(false) }
  }

  async function startPayment(plan: 'byok' | 'ollama') {
    const gatewayReady = billing?.gateway === 'razorpay' ? !!billing?.razorpay_key_id : !!billing?.stripe_pub_key
    if (!gatewayReady) {
      alert('Payment gateway not yet configured. Contact support.')
      return
    }
    setPayLoading(plan)
    try {
      const { data } = await api.post('/billing/create-order', { plan })

      // ── Stripe (global) ──────────────────────────────────────
      if (data.gateway === 'stripe') {
        // Redirect to Stripe Checkout hosted page
        window.location.href = data.checkout_url
        return
      }

      // ── Razorpay (India) ─────────────────────────────────────
      new window.Razorpay({
        key: data.key_id, amount: data.amount, currency: data.currency,
        name: 'Yantrik', description: data.label, order_id: data.order_id,
        handler: async (resp: any) => {
          await api.post('/billing/verify', {
            razorpay_order_id: resp.razorpay_order_id,
            razorpay_payment_id: resp.razorpay_payment_id,
            razorpay_signature: resp.razorpay_signature, plan,
          })
          const fresh = await api.get('/billing/status')
          setBilling(fresh.data)
        },
        prefill: { email: user?.email },
        theme: { color: '#f0a500' },
      }).open()
    } catch (err: any) { alert(err.response?.data?.detail || 'Failed to create order') }
    finally { setPayLoading(null) }
  }

  async function cancelSubscription() {
    if (!confirm('Cancel your subscription? You keep access until the end of the current billing period.')) return
    setCancelLoading(true)
    try {
      const { data } = await api.post('/billing/cancel')
      alert(data.message)
      const fresh = await api.get('/billing/status')
      setBilling(fresh.data)
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to cancel subscription')
    } finally { setCancelLoading(false) }
  }

  // Handle Stripe redirect-back success
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('payment') === 'success') {
      api.get('/billing/status').then(r => setBilling(r.data))
      window.history.replaceState({}, '', '/profile')
    }
  }, [])

  async function saveApiKey(provider: string) {
    const val = keyInputs[provider]?.trim(); if (!val) return
    setKeySaving(provider)
    try {
      await api.post('/billing/keys', { provider, key_value: val })
      setKeySuccess(provider)
      setKeyInputs(p => ({ ...p, [provider]: '' }))
      const fresh = await api.get('/billing/keys'); setSavedKeys(fresh.data.keys)
      setTimeout(() => setKeySuccess(null), 2000)
    } catch (err: any) { alert(err.response?.data?.detail || 'Failed to save key') }
    finally { setKeySaving(null) }
  }

  async function deleteKey(provider: string) {
    await api.delete(`/billing/keys/${provider}`)
    setSavedKeys(p => p.filter(k => k.provider !== provider))
  }

  const hasKey = (p: string) => savedKeys.some(k => k.provider === p)

  useEffect(() => {
    api.get('/friends/').then(r => setFriends(r.data)).catch(() => {})
    api.get('/friends/requests').then(r => setFriendReqs(r.data)).catch(() => {})
  }, [])

  async function addFriend() {
    if (!addUid.trim()) return
    setAddLoading(true); setAddResult('')
    try {
      const { data } = await api.post(`/friends/add/${addUid.trim().toUpperCase()}`)
      setAddResult('✓ ' + data.message); setAddUid('')
    } catch (err: any) { setAddResult('✗ ' + (err.response?.data?.detail || 'Failed')) }
    finally { setAddLoading(false) }
  }

  async function acceptFriend(uid: string) {
    await api.post(`/friends/accept/${uid}`)
    setFriendReqs(p => p.filter(r => r.uid !== uid))
    api.get('/friends/').then(r => setFriends(r.data))
  }

  async function rejectFriend(uid: string) {
    await api.post(`/friends/reject/${uid}`)
    setFriendReqs(p => p.filter(r => r.uid !== uid))
  }

  async function removeFriend(uid: string) {
    await api.delete(`/friends/${uid}`)
    setFriends(p => p.filter(f => f.uid !== uid))
  }

  return (
    <div style={S.root}>
      <div style={S.sidebar}>
        <div style={S.logo}>
          <img src="/logo.png" width="28" height="28" style={{ objectFit: 'contain' }} alt="Yantrik" />
          <span style={{ fontWeight: 800, fontSize: 20 }}>Yantrik</span>
        </div>
        <button className="btn btn-ghost" style={{ justifyContent: 'flex-start' }} onClick={() => navigate('/')}>
          <ArrowLeft size={15} /> Dashboard
        </button>
        <div style={{ flex: 1 }} />
        <button className="btn btn-danger" style={{ justifyContent: 'flex-start' }} onClick={() => { logout(); navigate('/auth') }}>
          <LogOut size={15} /> Sign Out
        </button>
      </div>

      <div style={S.main}>
        <h1 style={S.heading}>Profile & Billing</h1>
        <p style={S.sub}>Manage your account and model access</p>

        <div style={S.grid}>
          {/* Identity */}
          <div className="card" style={S.card}>
            <div style={S.secTitle}><User size={13} /> Identity</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8 }}>
              <div style={{ ...S.bigAvatar, background: selectedColor }}>{user?.username?.[0]?.toUpperCase()}</div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{user?.username}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>{user?.email}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                  <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>Your UID:</span>
                  <code style={{ fontSize: 12, fontFamily: 'var(--font-mono)', background: 'var(--accent-dim)', color: 'var(--accent)', padding: '1px 7px', borderRadius: 4, letterSpacing: '0.1em', fontWeight: 700 }}>{user?.uid}</code>
                  <button onClick={() => { navigator.clipboard.writeText(user?.uid || ''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', padding: 0, fontSize: 10 }} title="Copy UID">📋</button>
                </div>
              </div>
            </div>
          </div>

          {/* Color */}
          <div className="card" style={S.card}>
            <div style={S.secTitle}><Palette size={13} /> Avatar Color</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 8 }}>
              {COLORS.map(c => (
                <button key={c} onClick={() => setSelectedColor(c)} style={{
                  width: '100%', aspectRatio: '1', borderRadius: 8, border: 'none', cursor: 'pointer',
                  background: c, transition: 'transform 0.15s, outline 0.15s',
                  outline: selectedColor === c ? `2px solid ${c}` : '2px solid transparent',
                  outlineOffset: 3, transform: selectedColor === c ? 'scale(1.15)' : 'scale(1)',
                }} />
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ ...S.miniAvatar, background: selectedColor }}>{user?.username?.[0]?.toUpperCase()}</div>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', flex: 1 }}>Preview</span>
              <button className="btn btn-primary" style={{ padding: '7px 14px', fontSize: 13 }} onClick={saveColor}>
                {colorSaved ? <><Check size={12} /> Saved</> : 'Save'}
              </button>
            </div>
          </div>

          {/* Plans */}
          <div className="card" style={{ ...S.card, gridColumn: '1 / -1' }}>
            <div style={S.secTitle}><Zap size={13} /> Plans & Model Access</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14 }}>
              {[
                { id: 'free', name: 'Free', price: '₹0', active: true, tag: 'tag-green', features: ['Llama 3.3 70B (Groq)','Llama 3.1 8B (Groq)','Mixtral 8x7B (Groq)','Gemma 2 9B (Groq)'] },
                { id: 'byok', name: 'BYOK', price: billing?.plans?.byok?.display || '...', active: billing?.byok_enabled, tag: 'tag-amber', features: ['GPT-4o, GPT-4o Mini','Claude Opus / Sonnet / Haiku','Gemini 1.5 Pro & Flash','Your own API keys'] },
                { id: 'ollama', name: 'Ollama', price: billing?.plans?.ollama?.display || '...', active: billing?.ollama_enabled, tag: 'tag-purple', features: ['Everything in BYOK','Llama 3, Mistral, CodeLlama','Any custom Ollama model','Local inference, your hardware'] },
              ].map(plan => (
                <div key={plan.id} style={{ ...S.planCard, ...(plan.active ? S.planActive : {}) }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontWeight: 700, fontSize: 15 }}>{plan.name}</span>
                    {plan.active
                      ? <span className={`tag ${plan.tag}`}>Active</span>
                      : <span className="tag tag-blue">{plan.price}/mo</span>}
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 10 }}>
                    {plan.price} <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-muted)' }}>/month</span>
                  </div>
                  <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 5, fontSize: 13, color: 'var(--text-muted)', flex: 1 }}>
                    {plan.features.map(f => <li key={f}>✓ {f}</li>)}
                  </ul>
                  {!plan.active && plan.id !== 'free' && (
                    <button
                      className="btn btn-primary"
                      style={{ marginTop: 14, width: '100%', justifyContent: 'center', fontSize: 13 }}
                      disabled={payLoading === plan.id}
                      onClick={() => startPayment(plan.id as any)}
                    >
                      {payLoading === plan.id ? 'Opening...' : `Upgrade — ${plan.price}/mo`}
                    </button>
                  )}
                  {plan.active && plan.id !== 'free' && billing?.gateway === 'stripe' && (
                    <button
                      className="btn btn-ghost"
                      style={{ marginTop: 10, width: '100%', justifyContent: 'center', fontSize: 12, color: 'var(--text-dim)' }}
                      disabled={cancelLoading}
                      onClick={cancelSubscription}
                    >
                      {cancelLoading ? 'Cancelling...' : 'Cancel subscription'}
                    </button>
                  )}
                </div>
              ))}
            </div>
            {billing && !(billing.razorpay_key_id || billing.stripe_pub_key) && (
              <div style={S.notice}>
                ⚠️ Payment not configured yet. Add gateway keys to <code style={S.code}>.env</code>
                {billing.country === 'IN'
                  ? <> — needs <code style={S.code}>RAZORPAY_KEY_ID</code> + <code style={S.code}>RAZORPAY_KEY_SECRET</code></>
                  : <> — needs <code style={S.code}>STRIPE_SECRET_KEY</code> + <code style={S.code}>STRIPE_PUBLISHABLE_KEY</code></>}
              </div>
            )}
            {billing && (
              <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginTop: 6 }}>
                📍 Detected: {billing.country === 'IN' ? '🇮🇳 India' : `🌍 ${billing.country}`} — paying in {billing.currency} via {billing.gateway}
              </div>
            )}
          </div>

          {/* API Keys — Groq shown to all users; BYOK/Ollama keys only for paid tiers */}
          <div className="card" style={{ ...S.card, gridColumn: '1 / -1' }}>
            <div style={S.secTitle}><Key size={13} /> API Keys</div>
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Keys are AES-256 encrypted at rest. We never show them again after saving.
            </p>
            {!hasKey('groq') && (
              <div style={{ padding: '8px 12px', background: '#f0a50011', border: '1px solid #f0a50033', borderRadius: 8, fontSize: 12, color: 'var(--text-muted)' }}>
                ⚡ <strong>Required to use the agent:</strong> Add your free Groq API key below.
                Get one at <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>console.groq.com/keys</a> — it's free.
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginTop: 4 }}>
              {/* Groq — available to everyone */}
              <KeyRow
                provider="groq" label="Groq (Free models — required for agent)" placeholder="gsk_..." url="https://console.groq.com/keys"
                hasKey={hasKey('groq')}
                value={keyInputs['groq'] || ''}
                show={!!showKey['groq']}
                saving={keySaving === 'groq'}
                success={keySuccess === 'groq'}
                onChange={(v: string) => setKeyInputs(p => ({ ...p, groq: v }))}
                onToggleShow={() => setShowKey(p => ({ ...p, groq: !p['groq'] }))}
                onSave={() => saveApiKey('groq')}
                onDelete={() => deleteKey('groq')}
              />
              {/* BYOK keys — only shown when BYOK plan is active */}
              {billing?.byok_enabled && [
                { provider: 'openai',    label: 'OpenAI',             placeholder: 'sk-...',      url: 'https://platform.openai.com/api-keys' },
                { provider: 'anthropic', label: 'Anthropic (Claude)', placeholder: 'sk-ant-...', url: 'https://console.anthropic.com/settings/keys' },
                { provider: 'google',    label: 'Google (Gemini)',    placeholder: 'AIza...',     url: 'https://aistudio.google.com/app/apikey' },
              ].map(k => (
                <KeyRow key={k.provider} {...k}
                  hasKey={hasKey(k.provider)}
                  value={keyInputs[k.provider] || ''}
                  show={!!showKey[k.provider]}
                  saving={keySaving === k.provider}
                  success={keySuccess === k.provider}
                  onChange={(v: string) => setKeyInputs(p => ({ ...p, [k.provider]: v }))}
                  onToggleShow={() => setShowKey(p => ({ ...p, [k.provider]: !p[k.provider] }))}
                  onSave={() => saveApiKey(k.provider)}
                  onDelete={() => deleteKey(k.provider)}
                />
              ))}
              {billing?.ollama_enabled && (
                <KeyRow provider="ollama_url" label="Ollama Base URL" placeholder="http://localhost:11434" url="https://ollama.com/download"
                  hasKey={hasKey('ollama_url')}
                  value={keyInputs['ollama_url'] || ''}
                  show={!!showKey['ollama_url']}
                  saving={keySaving === 'ollama_url'}
                  success={keySuccess === 'ollama_url'}
                  onChange={(v: string) => setKeyInputs(p => ({ ...p, ollama_url: v }))}
                  onToggleShow={() => setShowKey(p => ({ ...p, ollama_url: !p['ollama_url'] }))}
                  onSave={() => saveApiKey('ollama_url')}
                  onDelete={() => deleteKey('ollama_url')}
                />
              )}
            </div>
          </div>

                    {/* Friends */}
          <div className="card" style={{ ...S.card, gridColumn: '1 / -1' }}>
            <div style={S.secTitle}><UserPlus size={13} /> Friends</div>

            {/* Add friend */}
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <input className="input" placeholder="Enter UID (e.g. AB12CD34)" value={addUid}
                onChange={e => setAddUid(e.target.value.toUpperCase())}
                style={{ maxWidth: 240, fontFamily: 'var(--font-mono)', letterSpacing: '0.08em' }}
                onKeyDown={e => e.key === 'Enter' && addFriend()}
              />
              <button className="btn btn-primary" style={{ padding: '9px 16px' }} onClick={addFriend} disabled={addLoading}>
                <UserPlus size={13} /> Add
              </button>
              {addResult && <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: addResult.startsWith('✓') ? 'var(--green)' : 'var(--red)' }}>{addResult}</span>}
            </div>

            {/* Incoming requests */}
            {friendReqs.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                  Incoming Requests ({friendReqs.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {friendReqs.map((r: any) => (
                    <div key={r.sender_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--bg2)', borderRadius: 8, border: '1px solid var(--border)' }}>
                      <div style={{ width: 28, height: 28, borderRadius: '50%', background: r.avatar_color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#fff' }}>
                        {r.username[0].toUpperCase()}
                      </div>
                      <div style={{ flex: 1 }}>
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{r.username}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginLeft: 8 }}>{r.uid}</span>
                      </div>
                      <button className="btn btn-ghost" style={{ padding: '5px 8px', color: 'var(--green)' }} onClick={() => acceptFriend(r.uid)}><UserCheck size={14} /></button>
                      <button className="btn btn-ghost" style={{ padding: '5px 8px', color: 'var(--red)' }} onClick={() => rejectFriend(r.uid)}><UserX size={14} /></button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Friends list */}
            {friends.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
                {friends.map((f: any) => (
                  <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--bg2)', borderRadius: 8, border: '1px solid var(--border)' }}>
                    <div style={{ width: 28, height: 28, borderRadius: '50%', background: f.avatar_color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                      {f.username[0].toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.username}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{f.uid}</div>
                    </div>
                    <button className="btn btn-ghost" style={{ padding: '4px', color: 'var(--text-dim)', flexShrink: 0 }} onClick={() => removeFriend(f.uid)} title="Remove friend">
                      <UserX size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {friends.length === 0 && friendReqs.length === 0 && (
              <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>No friends yet. Share your UID above to connect.</p>
            )}
          </div>

          {/* Password */}
          <div className="card" style={{ ...S.card, gridColumn: '1 / -1' }}>
            <div style={S.secTitle}><Key size={13} /> Change Password</div>
            <form onSubmit={changePassword} style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, alignItems: 'end' }}>
              {[['Current', currentPw, setCurrentPw], ['New', newPw, setNewPw], ['Confirm', confirmPw, setConfirmPw]].map(([l, v, fn]: any) => (
                <div key={l} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <label style={S.label}>{l} Password</label>
                  <input className="input" type="password" placeholder="••••••••" value={v} onChange={e => fn(e.target.value)} required />
                </div>
              ))}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <div style={{ height: 22 }} />
                <button className="btn btn-primary" disabled={pwLoading}>{pwLoading ? 'Saving...' : 'Update'}</button>
              </div>
            </form>
            {pwError   && <p style={{ color: 'var(--red)',   fontSize: 12, fontFamily: 'var(--font-mono)' }}>{pwError}</p>}
            {pwSuccess && <p style={{ color: 'var(--green)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>✓ Password updated</p>}
          </div>
        </div>
      </div>
    </div>
  )
}

function KeyRow({ provider, label, placeholder, url, hasKey, value, show, saving, success, onChange, onToggleShow, onSave, onDelete }: any) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{label}</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {hasKey && <span className="tag tag-green" style={{ fontSize: 10 }}>✓ Saved</span>}
          <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-dim)', display: 'flex' }}><ExternalLink size={12} /></a>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <input className="input" type={show ? 'text' : 'password'}
            placeholder={hasKey ? '••••••••••••' : placeholder}
            value={value} onChange={e => onChange(e.target.value)} style={{ paddingRight: 36 }} />
          <button type="button" onClick={onToggleShow} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer' }}>
            {show ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        </div>
        <button className="btn btn-primary" style={{ padding: '9px 14px', fontSize: 13 }} onClick={onSave} disabled={!value || saving}>
          {success ? <Check size={13} /> : saving ? '...' : 'Save'}
        </button>
        {hasKey && (
          <button className="btn btn-ghost" style={{ padding: '9px', color: 'var(--red)' }} onClick={onDelete}>
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  root: { display: 'flex', height: '100vh', overflow: 'hidden' },
  sidebar: { width: 220, background: 'var(--glass)', backdropFilter: 'blur(24px)', borderRight: '1px solid var(--glass-border)', display: 'flex', flexDirection: 'column', padding: '18px 14px', gap: 8, flexShrink: 0 },
  logo: { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0 14px' },
  main: { flex: 1, overflow: 'auto', padding: 28 },
  heading: { fontSize: 24, fontWeight: 800, letterSpacing: '-0.03em' },
  sub: { color: 'var(--text-muted)', fontSize: 13, marginTop: 4, marginBottom: 24 },
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, maxWidth: 920 },
  card: { display: 'flex', flexDirection: 'column', gap: 14 },
  secTitle: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: 'var(--text-dim)', fontFamily: 'var(--mono)' },
  bigAvatar: { width: 48, height: 48, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 800, color: '#fff', flexShrink: 0, boxShadow: '0 4px 12px rgba(0,0,0,0.25)' },
  miniAvatar: { width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#fff' },
  planCard: { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, display: 'flex', flexDirection: 'column', transition: 'border-color 0.2s' },
  planActive: { borderColor: 'rgba(45,212,191,0.25)', background: 'var(--teal-dim)' },
  notice: { marginTop: 10, padding: '10px 14px', background: 'var(--amber-dim)', border: '1px solid rgba(251,191,36,0.12)', borderRadius: 8, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 },
  code: { color: 'var(--teal)', fontFamily: 'var(--mono)' },
  label: { fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' as const, letterSpacing: '0.06em', fontFamily: 'var(--mono)' },
}
