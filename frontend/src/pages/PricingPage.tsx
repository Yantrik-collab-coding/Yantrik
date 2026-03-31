import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Gift, Clock } from 'lucide-react'
import api from '../lib/api'

interface LaunchWindow {
  launch_date: string; free_until: string
  in_free_window: boolean; days_remaining: number
}

function Countdown({ freeUntil }: { freeUntil: string }) {
  const [timeLeft, setTimeLeft] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 })
  useEffect(() => {
    const target = new Date(freeUntil + 'T23:59:59')
    const tick = () => {
      const diff = target.getTime() - Date.now()
      if (diff <= 0) { setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0 }); return }
      setTimeLeft({
        days: Math.floor(diff / 86400000), hours: Math.floor((diff % 86400000) / 3600000),
        minutes: Math.floor((diff % 3600000) / 60000), seconds: Math.floor((diff % 60000) / 1000),
      })
    }
    tick(); const id = setInterval(tick, 1000); return () => clearInterval(id)
  }, [freeUntil])
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    <div style={S.countdown}>
      {([['days', timeLeft.days], ['hrs', timeLeft.hours], ['min', timeLeft.minutes], ['sec', timeLeft.seconds]] as [string, number][]).map(([label, val]) => (
        <div key={label} style={S.countUnit}>
          <span style={S.countNum}>{pad(val)}</span>
          <span style={S.countLabel}>{label}</span>
        </div>
      ))}
    </div>
  )
}

const plans = [
  { name: 'Free', price: '₹0', priceGlobal: '$0', per: '/month', tag: 'tag-green', tagLabel: 'Free Forever',
    features: ['Llama 3.3 70B (Groq)', 'Llama 3.1 8B (Groq)', 'Mixtral 8x7B (Groq)', 'Gemma 2 9B (Groq)', 'Unlimited private projects', 'Open Forum access', 'Real-time collaboration', 'AI agent in chat'],
    cta: 'Get Started', ctaStyle: 'btn-ghost' },
  { name: 'BYOK', price: '₹25', priceGlobal: '$2', per: '/month', tag: 'tag-amber', tagLabel: 'Most Popular',
    features: ['Everything in Free', 'GPT-4o & GPT-4o Mini', 'Claude Opus / Sonnet / Haiku', 'Gemini 1.5 Pro & Flash 2.0', 'Use your own API keys', 'All future BYOK models', 'Priority support'],
    cta: 'Upgrade Now', ctaStyle: 'btn-primary' },
  { name: 'Ollama', price: '₹35', priceGlobal: '$3', per: '/month', tag: 'tag-purple', tagLabel: 'Power Users',
    features: ['Everything in BYOK', 'Local Ollama models', 'Llama 3, Mistral, CodeLlama', 'Any custom Ollama model', '100% private inference', 'No API costs ever', 'Your hardware, your data'],
    cta: 'Upgrade Now', ctaStyle: 'btn-primary' },
]

export default function PricingPage() {
  const navigate = useNavigate()
  const [window_, setWindow] = useState<LaunchWindow | null>(null)
  useEffect(() => { api.get('/billing/launch').then(r => setWindow(r.data)).catch(() => {}) }, [])
  const inFreeWindow = window_?.in_free_window ?? false

  return (
    <div style={S.root}>
      <div style={S.bg} />
      <button style={S.back} onClick={() => navigate('/')}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-dim)'}>
        ← Back
      </button>

      {inFreeWindow && window_ && (
        <div style={S.banner}>
          <div style={S.bannerInner}>
            <div style={S.bannerLeft}>
              <Gift size={18} color="var(--teal)" />
              <div>
                <div style={S.bannerTitle}>🎉 Everything is free right now</div>
                <div style={S.bannerSub}>
                  All plans unlocked — no payment needed until{' '}
                  <strong>{new Date(window_.free_until).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</strong>
                </div>
              </div>
            </div>
            <div style={S.bannerRight}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, color: 'var(--text-muted)', fontSize: 10, fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                <Clock size={10} /> Free window ends in
              </div>
              <Countdown freeUntil={window_.free_until} />
            </div>
          </div>
        </div>
      )}

      <div style={S.hero}>
        <div className="tag tag-blue" style={{ fontSize: 11, marginBottom: 14 }}>Simple Pricing</div>
        <h1 style={S.title}>Pay less. Build more.</h1>
        <p style={S.sub}>India pricing in ₹ · Global pricing in $ · No hidden fees · Cancel anytime</p>
      </div>

      <div style={S.grid}>
        {plans.map((p, i) => (
          <div key={p.name} style={{ ...S.card, ...(i === 1 ? S.cardFeatured : {}) }}>
            {i === 1 && <div style={S.featuredBadge}>⚡ Most Popular</div>}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={S.planName}>{p.name}</div>
                <div style={S.planPrice}>
                  {inFreeWindow ? (
                    <><span style={{ color: 'var(--teal)' }}>Free</span>{i > 0 && <span style={{ fontSize: 15, color: 'var(--text-dim)', textDecoration: 'line-through', marginLeft: 8 }}>{p.price}</span>}</>
                  ) : (<>{p.price} <span style={S.planPer}>{p.per}</span></>)}
                </div>
                {!inFreeWindow && <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--mono)' }}>{p.priceGlobal}{p.per} globally</div>}
                {inFreeWindow && i > 0 && <div style={{ fontSize: 10, color: 'var(--teal)', fontFamily: 'var(--mono)', marginTop: 2 }}>unlocked during launch</div>}
              </div>
              <span className={`tag ${inFreeWindow && i > 0 ? 'tag-teal' : p.tag}`}>
                {inFreeWindow && i > 0 ? '🎁 Free now' : p.tagLabel}
              </span>
            </div>
            <ul style={S.features}>
              {p.features.map(f => (
                <li key={f} style={S.feature}><Check size={12} color="var(--green)" style={{ flexShrink: 0, marginTop: 1 }} />{f}</li>
              ))}
            </ul>
            <button className={`btn ${inFreeWindow && i > 0 ? 'btn-primary' : p.ctaStyle}`}
              style={{ width: '100%', justifyContent: 'center', marginTop: 'auto' }}
              onClick={() => navigate(i === 0 ? '/auth' : '/profile')}>
              {inFreeWindow && i > 0 ? 'Use for Free →' : p.cta}
            </button>
          </div>
        ))}
      </div>

      {inFreeWindow && (
        <div style={S.freeNote}>
          <span style={{ color: 'var(--text-dim)' }}>After the free window ends, you'll need a plan to keep using BYOK & Ollama models.</span><br />
          <span style={{ color: 'var(--text-muted)' }}>Free plan users always keep Groq models at no cost.</span>
        </div>
      )}

      <div style={S.faq}>
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 22, textAlign: 'center' }}>FAQ</h2>
        <div style={S.faqGrid}>
          {[
            ['What is BYOK?', 'Bring Your Own Key — you paste your OpenAI, Anthropic, or Google API key. We never charge you for model usage, you pay the provider directly.'],
            ['Is my data safe?', 'Yes. API keys are AES-256 encrypted. Your private workspaces are never visible to others. Open Forum projects are public by your choice.'],
            ['Can I cancel anytime?', 'Yes. No contracts, no lock-in. Downgrade or cancel from your profile page at any time.'],
            ['What payment methods?', 'India: UPI, cards, netbanking via Razorpay. Global: All major cards via Stripe.'],
            ['Do Groq models cost anything?', "No. Groq's free tier is used for all free plan models. No usage limits for normal use."],
            ['Can I host hackathons on Free?', 'Yes! Hackathons are available on all plans. Participants need their own accounts.'],
          ].map(([q, a]) => (
            <div key={q} className="card" style={S.faqCard}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>{q}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>{a}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  root: { minHeight: '100vh', background: 'var(--bg)', padding: '40px 36px', position: 'relative', overflow: 'hidden' },
  bg: { position: 'fixed', inset: 0, backgroundImage: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(96,165,250,0.06), transparent)', pointerEvents: 'none' },
  back: { position: 'absolute', top: 20, left: 36, background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 12, fontFamily: 'var(--mono)', transition: 'color 0.15s' },
  banner: { maxWidth: 880, margin: '0 auto 36px', borderRadius: 14, background: 'linear-gradient(135deg, rgba(45,212,191,0.05), rgba(96,165,250,0.04))', border: '1px solid rgba(45,212,191,0.12)', padding: '18px 24px' },
  bannerInner: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' },
  bannerLeft: { display: 'flex', alignItems: 'flex-start', gap: 14 },
  bannerTitle: { fontSize: 15, fontWeight: 700, marginBottom: 4 },
  bannerSub: { fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 },
  bannerRight: { textAlign: 'right' },
  countdown: { display: 'flex', gap: 6 },
  countUnit: { display: 'flex', flexDirection: 'column', alignItems: 'center', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: '5px 10px', minWidth: 46 },
  countNum: { fontSize: 18, fontWeight: 800, fontFamily: 'var(--mono)', color: 'var(--teal)', lineHeight: 1 },
  countLabel: { fontSize: 8, color: 'var(--text-dim)', fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 3 },
  hero: { textAlign: 'center', marginBottom: 44, paddingTop: 8 },
  title: { fontSize: 42, fontWeight: 800, letterSpacing: '-0.03em', marginBottom: 10 },
  sub: { fontSize: 14, color: 'var(--text-muted)', fontFamily: 'var(--mono)' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 18, maxWidth: 960, margin: '0 auto 28px' },
  card: { background: 'var(--bg1)', border: '1px solid var(--border)', borderRadius: 16, padding: 26, display: 'flex', flexDirection: 'column', gap: 18, position: 'relative', transition: 'border-color 0.2s, box-shadow 0.25s' },
  cardFeatured: { border: '1px solid rgba(45,212,191,0.25)', background: 'var(--teal-dim)', boxShadow: 'var(--shadow-glow)', transform: 'scale(1.02)' },
  featuredBadge: { position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)', background: 'var(--teal)', color: '#090b0f', fontSize: 10, fontWeight: 700, padding: '3px 12px', borderRadius: 20, whiteSpace: 'nowrap' },
  planName: { fontSize: 18, fontWeight: 800, letterSpacing: '-0.02em' },
  planPrice: { fontSize: 32, fontWeight: 800, letterSpacing: '-0.03em', marginTop: 4 },
  planPer: { fontSize: 14, fontWeight: 400, color: 'var(--text-muted)' },
  features: { listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8, flex: 1 },
  feature: { display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4 },
  freeNote: { textAlign: 'center', fontSize: 11, marginBottom: 48, lineHeight: 2 },
  faq: { maxWidth: 880, margin: '0 auto' },
  faqGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 },
  faqCard: { padding: 18 },
}
