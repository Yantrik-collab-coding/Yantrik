import React, { useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Code2, Users, Zap, Sparkles, GitBranch, Terminal } from 'lucide-react'
import { useAuthStore } from '../lib/store'

const LandingPage: React.FC = () => {
  const navigate = useNavigate()
  const { token } = useAuthStore()
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const handleGetStarted = () => {
    navigate(token ? '/dashboard' : '/auth')
  }

  const features = [
    {
      icon: <Code2 size={22} />,
      title: 'AI-Powered Coding',
      description: 'Multiple LLM providers including Groq, OpenAI, Anthropic, and Google'
    },
    {
      icon: <Users size={22} />,
      title: 'Team Collaboration',
      description: 'Real-time collaboration with shared workspaces and instant sync'
    },
    {
      icon: <Terminal size={22} />,
      title: 'Integrated Terminal',
      description: 'Full PTY terminal support for seamless development workflow'
    },
    {
      icon: <Zap size={22} />,
      title: 'Lightning Fast',
      description: 'Optimized for speed with instant feedback and real-time updates'
    },
    {
      icon: <GitBranch size={22} />,
      title: 'Git Integration',
      description: 'Built-in version control with branch management and conflict resolution'
    },
    {
      icon: <Sparkles size={22} />,
      title: 'Smart Agents',
      description: 'Autonomous AI agents that help with complex coding tasks'
    }
  ]

  // Shader background hook
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const gl = canvas.getContext('webgl2')
    if (!gl) return

    const vertexSrc = `#version 300 es
precision highp float;
in vec4 position;
void main(){gl_Position=position;}`

    const fragmentSrc = `#version 300 es
precision highp float;
out vec4 O;
uniform vec2 resolution;
uniform float time;
#define FC gl_FragCoord.xy
#define T time
#define R resolution
#define MN min(R.x,R.y)
float rnd(vec2 p) {
  p=fract(p*vec2(12.9898,78.233));
  p+=dot(p,p+34.56);
  return fract(p.x*p.y);
}
float noise(in vec2 p) {
  vec2 i=floor(p), f=fract(p), u=f*f*(3.-2.*f);
  float a=rnd(i), b=rnd(i+vec2(1,0)), c=rnd(i+vec2(0,1)), d=rnd(i+1.);
  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);
}
float fbm(vec2 p) {
  float t=.0, a=1.; mat2 m=mat2(1.,-.5,.2,1.2);
  for (int i=0; i<5; i++) {
    t+=a*noise(p); p*=2.*m; a*=.5;
  }
  return t;
}
float clouds(vec2 p) {
  float d=1., t=.0;
  for (float i=.0; i<3.; i++) {
    float a=d*fbm(i*10.+p.x*.2+.2*(1.+i)*p.y+d+i*i+p);
    t=mix(t,d,a); d=a; p*=2./(i+1.);
  }
  return t;
}
void main(void) {
  vec2 uv=(FC-.5*R)/MN, st=uv*vec2(2,1);
  vec3 col=vec3(0);
  float bg=clouds(vec2(st.x+T*.5,-st.y));
  uv*=1.-.3*(sin(T*.2)*.5+.5);
  for (float i=1.; i<12.; i++) {
    uv+=.1*cos(i*vec2(.1+.01*i, .8)+i*i+T*.5+.1*uv.x);
    vec2 p=uv;
    float d=length(p);
    col+=.00125/d*(cos(sin(i)*vec3(1,2,3))+1.);
    float b=noise(i+p+bg*1.731);
    col+=.002*b/length(max(p,vec2(b*p.x*.02,p.y)));
    col=mix(col,vec3(bg*.25,bg*.137,bg*.05),d);
  }
  O=vec4(col,1);
}`

    const vs = gl.createShader(gl.VERTEX_SHADER)!
    const fs = gl.createShader(gl.FRAGMENT_SHADER)!
    gl.shaderSource(vs, vertexSrc)
    gl.compileShader(vs)
    gl.shaderSource(fs, fragmentSrc)
    gl.compileShader(fs)

    const program = gl.createProgram()!
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    gl.useProgram(program)

    const vertices = new Float32Array([-1, 1, -1, -1, 1, 1, 1, -1])
    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW)

    const position = gl.getAttribLocation(program, 'position')
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)

    const uResolution = gl.getUniformLocation(program, 'resolution')
    const uTime = gl.getUniformLocation(program, 'time')

    const resize = () => {
      const dpr = Math.max(1, 0.5 * window.devicePixelRatio)
      canvas.width = window.innerWidth * dpr
      canvas.height = window.innerHeight * dpr
      gl.viewport(0, 0, canvas.width, canvas.height)
    }
    resize()

    let animId: number
    const render = (now: number) => {
      gl.uniform2f(uResolution, canvas.width, canvas.height)
      gl.uniform1f(uTime, now * 1e-3)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      animId = requestAnimationFrame(render)
    }
    animId = requestAnimationFrame(render)

    window.addEventListener('resize', resize)
    return () => {
      window.removeEventListener('resize', resize)
      cancelAnimationFrame(animId)
      gl.deleteProgram(program)
    }
  }, [])

  return (
    <div style={{ position: 'relative', minHeight: '100vh', background: '#000', overflow: 'hidden' }}>
      <style>{`
        @keyframes logoFloat {
          0%, 100% {
            transform: translateY(0) scale(1);
            filter: drop-shadow(0 0 20px rgba(45, 212, 191, 0.5));
          }
          50% {
            transform: translateY(-12px) scale(1.08);
            filter: drop-shadow(0 0 40px rgba(45, 212, 191, 0.8));
          }
        }
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(30px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeInDown {
          from { opacity: 0; transform: translateY(-30px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
        .logo-animate { animation: logoFloat 3s ease-in-out infinite; }
        .fade-in-up { animation: fadeInUp 0.9s ease-out forwards; opacity: 0; }
        .fade-in-down { animation: fadeInDown 0.8s ease-out forwards; }
        .delay-100 { animation-delay: 0.15s; }
        .delay-200 { animation-delay: 0.3s; }
        .delay-300 { animation-delay: 0.45s; }
        .cta-btn:hover { transform: scale(1.05); box-shadow: 0 16px 48px rgba(45,212,191,0.5) !important; }
        .cta-btn { transition: transform 0.25s ease, box-shadow 0.25s ease; }
      `}</style>

      {/* Shader Background Canvas */}
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: '#000',
          zIndex: 0
        }}
      />

      {/* Content Container */}
      <div style={{ position: 'relative', zIndex: 10, minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>

        {/* Hero Section - Centered Content */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px',
          textAlign: 'center',
        }}>
          {/* Animated Logo at Center Top */}
          <div className="logo-animate fade-in-down" style={{ marginBottom: '40px' }}>
            <div
              style={{
                width: '80px',
                height: '80px',
                borderRadius: '20px',
                background: 'linear-gradient(135deg, #2dd4bf, #10b981)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 0 60px rgba(45, 212, 191, 0.6), 0 0 100px rgba(45, 212, 191, 0.3)',
                margin: '0 auto',
              }}
            >
              <img
                src="/logo.png"
                width="48"
                height="48"
                style={{ objectFit: 'contain' }}
                alt="Yantrik"
              />
            </div>
          </div>

          {/* Main Headline */}
          <div className="fade-in-up delay-100" style={{ maxWidth: '800px', margin: '0 auto 24px' }}>
            <h1
              style={{
                fontSize: 'clamp(36px, 7vw, 72px)',
                fontWeight: 800,
                background: 'linear-gradient(135deg, #99f6e4, #2dd4bf, #14b8a6)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
                lineHeight: 1.1,
                letterSpacing: '-0.02em',
              }}
            >
              Collaborative AI
            </h1>
            <h1
              style={{
                fontSize: 'clamp(36px, 7vw, 72px)',
                fontWeight: 800,
                background: 'linear-gradient(135deg, #2dd4bf, #14b8a6, #0d9488)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
                lineHeight: 1.1,
                letterSpacing: '-0.02em',
              }}
            >
              for Team Coding
            </h1>
          </div>

          {/* Subtitle */}
          <p
            className="fade-in-up delay-200"
            style={{
              fontSize: 'clamp(15px, 2.5vw, 20px)',
              color: 'rgba(204, 251, 241, 0.9)',
              fontWeight: 400,
              lineHeight: 1.6,
              maxWidth: '650px',
              margin: '0 auto',
            }}
          >
            Yantrik is your AI-powered team IDE — think Cursor meets Discord for developers.
            Build faster with intelligent code assistance and real-time collaboration.
          </p>

          {/* CTA Button */}
          <div className="fade-in-up delay-300" style={{ marginTop: '48px' }}>
            <button
              onClick={handleGetStarted}
              className="cta-btn"
              style={{
                display: 'inline-block',
                padding: '18px 48px',
                borderRadius: '9999px',
                fontWeight: 700,
                fontSize: '17px',
                background: 'linear-gradient(135deg, #2dd4bf, #14b8a6)',
                color: '#000',
                border: 'none',
                cursor: 'pointer',
                boxShadow: '0 8px 40px rgba(45, 212, 191, 0.5)',
                textDecoration: 'none',
              }}
            >
              Get Started →
            </button>
          </div>
        </div>

        {/* Features Section */}
        <section style={{ padding: '80px 16px', background: 'linear-gradient(to bottom, transparent, #000)', position: 'relative' }}>
          <div className="max-w-6xl mx-auto">
            <div style={{ textAlign: 'center', marginBottom: '48px' }}>
              <p style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: '#2dd4bf', letterSpacing: '0.2em', marginBottom: '16px' }}>
                FEATURES
              </p>
              <h2 style={{ fontSize: 'clamp(24px, 4vw, 36px)', fontWeight: 700, color: '#fff', lineHeight: 1.3 }}>
                Everything you need to{' '}
                <span style={{ background: 'linear-gradient(135deg, #2dd4bf, #34d399)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
                  build faster
                </span>
              </h2>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px' }}>
              {features.map((feature, index) => (
                <div
                  key={index}
                  className="cta-btn"
                  style={{
                    padding: '24px',
                    borderRadius: '14px',
                    background: 'rgba(19, 22, 29, 0.7)',
                    backdropFilter: 'blur(8px)',
                    border: '1px solid rgba(28, 32, 48, 0.6)',
                    transition: 'transform 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease',
                  }}
                >
                  <div
                    style={{
                      width: '44px',
                      height: '44px',
                      borderRadius: '10px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginBottom: '14px',
                      background: 'rgba(45, 212, 191, 0.12)',
                      border: '1px solid rgba(45, 212, 191, 0.25)',
                      color: '#2dd4bf',
                    }}
                  >
                    {feature.icon}
                  </div>
                  <h3 style={{ fontSize: '17px', fontWeight: 600, color: '#fff', marginBottom: '6px' }}>{feature.title}</h3>
                  <p style={{ color: 'rgba(156, 163, 175, 0.9)', lineHeight: 1.5, fontSize: '14px' }}>{feature.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer style={{ padding: '24px 16px', borderTop: '1px solid rgba(28, 32, 48, 0.5)', background: '#000' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
            <div
              style={{
                width: '24px',
                height: '24px',
                borderRadius: '6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'linear-gradient(135deg, #2dd4bf, #14b8a6)',
              }}
            >
              <Code2 size={14} color="#000" />
            </div>
            <span style={{ color: 'rgba(156, 163, 175, 0.8)', fontSize: '13px' }}>
              © 2026 Yantrik
            </span>
          </div>
        </footer>
      </div>
    </div>
  )
}

export default LandingPage
