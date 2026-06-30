import { useState, useCallback, useRef } from 'react'
import { useNavigate, Link, Navigate } from 'react-router-dom'
import { httpPost } from '../api/dotnet-client'
import { useAuthStore } from '../stores/auth-store'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'

gsap.registerPlugin(useGSAP)

interface LoginResponse {
  access_token: string
  refresh_token: string
  user: { id: string; email: string; display_name: string }
}

export function LoginPage() {
  const navigate = useNavigate()
  const setAuth = useAuthStore(s => s.setAuth)
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const hasHydrated = useAuthStore(s => s.hasHydrated)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const rootRef = useRef<HTMLDivElement>(null)

  useGSAP(() => {
    /* ── Initial states ── */
    gsap.set('.geo-ring', { scale: 0, autoAlpha: 0, transformOrigin: 'center center' })
    gsap.set('.geo-line', { strokeDashoffset: 300, autoAlpha: 0 })
    gsap.set('.orbit-dot', { scale: 0 })
    gsap.set('.hero-char', { y: 80, autoAlpha: 0, rotation: 8 })
    gsap.set('.hero-sub', { autoAlpha: 0, x: -30 })
    gsap.set('.hero-accent', { scaleX: 0, transformOrigin: 'left center' })
    gsap.set('.form-card', { autoAlpha: 0, scale: 0.92, y: 40 })
    gsap.set('.field-row', { autoAlpha: 0, x: 40 })
    gsap.set('.form-btn', { autoAlpha: 0, scale: 0.8 })
    gsap.set('.form-footer', { autoAlpha: 0 })
    gsap.set('.bottom-line', { scaleX: 0, transformOrigin: 'left center' })

    const mm = gsap.matchMedia()
    mm.add(
      {
        normal: '(prefers-reduced-motion: no-preference)',
        reduce: '(prefers-reduced-motion: reduce)',
      },
      (ctx) => {
        const { reduce } = ctx.conditions!
        if (reduce) {
          gsap.set('.geo-ring, .geo-line, .orbit-dot, .hero-char, .hero-sub, .hero-accent, .form-card, .field-row, .form-btn, .form-footer, .bottom-line',
            { autoAlpha: 1, scale: 1, x: 0, y: 0, rotation: 0, scaleX: 1, strokeDashoffset: 0 })
          return
        }

        const tl = gsap.timeline()

        /* ── Act 1: Geometric background reveal ── */
        tl.to('.geo-ring', {
          scale: 1, autoAlpha: 1,
          duration: 1.2,
          stagger: { each: 0.15, from: 'center' },
          ease: 'elastic.out(1, 0.5)',
        }, 0)

        tl.to('.geo-line', {
          strokeDashoffset: 0, autoAlpha: 1,
          duration: 1.4,
          stagger: 0.1,
          ease: 'power2.inOut',
        }, 0.2)

        tl.to('.orbit-dot', {
          scale: 1,
          duration: 0.6,
          stagger: { each: 0.08, from: 'random' },
          ease: 'back.out(3)',
        }, 0.6)

        /* ── Act 2: Typography ── */
        tl.to('.hero-char', {
          y: 0, autoAlpha: 1, rotation: 0,
          duration: 0.7,
          stagger: 0.05,
          ease: 'back.out(1.4)',
        }, 0.5)

        tl.to('.hero-accent', {
          scaleX: 1,
          duration: 0.8,
          ease: 'power3.inOut',
        }, 0.9)

        tl.to('.hero-sub', {
          autoAlpha: 1, x: 0,
          duration: 0.6,
          ease: 'power2.out',
        }, 1.1)

        /* ── Act 3: Form card ── */
        tl.to('.form-card', {
          autoAlpha: 1, scale: 1, y: 0,
          duration: 0.8,
          ease: 'back.out(1.2)',
        }, 0.7)

        tl.to('.field-row', {
          autoAlpha: 1, x: 0,
          duration: 0.5,
          stagger: 0.1,
          ease: 'power3.out',
        }, 1.0)

        tl.to('.form-btn', {
          autoAlpha: 1, scale: 1,
          duration: 0.5,
          ease: 'back.out(2)',
        }, 1.2)

        tl.to('.form-footer', {
          autoAlpha: 1,
          duration: 0.4,
        }, 1.35)

        tl.to('.bottom-line', {
          scaleX: 1,
          duration: 1,
          ease: 'power2.inOut',
        }, 1.2)

        /* ── Infinite loops ── */

        // Rings pulse
        gsap.to('.geo-ring', {
          scale: 1.04,
          duration: 3,
          stagger: { each: 0.5, repeat: -1, yoyo: true },
          ease: 'sine.inOut',
        })

        // Orbit dots rotate around their rings
        gsap.to('.orbit-group-1', {
          rotation: 360,
          duration: 20,
          repeat: -1,
          ease: 'none',
          transformOrigin: 'center center',
        })
        gsap.to('.orbit-group-2', {
          rotation: -360,
          duration: 28,
          repeat: -1,
          ease: 'none',
          transformOrigin: 'center center',
        })
        gsap.to('.orbit-group-3', {
          rotation: 360,
          duration: 35,
          repeat: -1,
          ease: 'none',
          transformOrigin: 'center center',
        })

        // Decorative lines shimmer
        gsap.to('.geo-line', {
          strokeDashoffset: -300,
          duration: 8,
          stagger: 1.5,
          repeat: -1,
          ease: 'none',
        })
      }
    )
  }, { scope: rootRef })

  if (hasHydrated && isAuthenticated) {
    return <Navigate to="/select-dept" replace />
  }

  const handleSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      setLoading(true)
      setError(null)
      try {
        const data = await httpPost<LoginResponse>('/api/auth/login', { email, password })
        if (data.refresh_token) {
          localStorage.setItem('llmwiki:auth:refresh_token', data.refresh_token)
        }
        setAuth(
          { id: data.user.id, email: data.user.email, displayName: data.user.display_name },
          data.access_token
        )
        navigate('/select-dept', { replace: true })
      } catch (err) {
        setError(err instanceof Error ? err.message : '邮箱或密码错误')
      } finally {
        setLoading(false)
      }
    },
    [email, password, setAuth, navigate]
  )

  return (
    <div ref={rootRef} className="flex min-h-screen bg-[oklch(0.11_0_0)]">
      {/* ── Left: animated geometric hero ── */}
      <div className="relative hidden w-[55%] overflow-hidden lg:flex lg:items-center lg:justify-center">
        {/* SVG geometric art — all GSAP-driven */}
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 800 800" fill="none" preserveAspectRatio="xMidYMid slice">
          {/* Concentric rings with elastic pop-in */}
          {[280, 220, 160, 100, 50].map((r, i) => (
            <circle key={i} className="geo-ring" cx="400" cy="400" r={r}
              stroke="rgba(255,255,255,0.06)" strokeWidth="0.8" />
          ))}

          {/* Decorative dashed lines — stroke animation */}
          {[30, 75, 120, 165, 210, 255, 300, 345].map((angle, i) => {
            const rad = (angle * Math.PI) / 180
            const x2 = 400 + Math.cos(rad) * 350
            const y2 = 400 + Math.sin(rad) * 350
            return (
              <line key={i} className="geo-line"
                x1="400" y1="400" x2={x2} y2={y2}
                stroke="rgba(255,255,255,0.04)" strokeWidth="0.5"
                strokeDasharray="4 8"
              />
            )
          })}

          {/* Orbiting dots — GSAP rotation groups */}
          <g className="orbit-group-1" style={{ transformOrigin: '400px 400px' }}>
            {[0, 120, 240].map((angle, i) => {
              const rad = (angle * Math.PI) / 180
              return (
                <circle key={i} className="orbit-dot"
                  cx={400 + Math.cos(rad) * 280} cy={400 + Math.sin(rad) * 280}
                  r="3" fill="rgba(255,255,255,0.7)" />
              )
            })}
          </g>
          <g className="orbit-group-2" style={{ transformOrigin: '400px 400px' }}>
            {[45, 165, 285].map((angle, i) => {
              const rad = (angle * Math.PI) / 180
              return (
                <circle key={i} className="orbit-dot"
                  cx={400 + Math.cos(rad) * 220} cy={400 + Math.sin(rad) * 220}
                  r="2.5" fill="rgba(255,255,255,0.5)" />
              )
            })}
          </g>
          <g className="orbit-group-3" style={{ transformOrigin: '400px 400px' }}>
            {[20, 110, 200, 290].map((angle, i) => {
              const rad = (angle * Math.PI) / 180
              return (
                <circle key={i} className="orbit-dot"
                  cx={400 + Math.cos(rad) * 160} cy={400 + Math.sin(rad) * 160}
                  r="2" fill="rgba(255,255,255,0.4)" />
              )
            })}
          </g>

          {/* Intersection glow at center */}
          <circle cx="400" cy="400" r="4" fill="rgba(255,255,255,0.8)" />
          <circle cx="400" cy="400" r="12" fill="rgba(255,255,255,0.05)" />
        </svg>

        {/* Typography overlay */}
        <div className="relative z-10 px-14">
          <h1 className="text-[5rem] font-bold leading-[1] tracking-tighter text-white">
            {'知识无界'.split('').map((ch, i) => (
              <span key={i} className="hero-char inline-block">{ch}</span>
            ))}
          </h1>
          <div className="hero-accent mt-4 h-[2px] w-16 bg-white/40" />
          <p className="hero-sub mt-5 max-w-[280px] text-sm leading-relaxed text-white/40">
            AI 驱动的知识库，将文档、网页、代码转化为结构化 Wiki
          </p>
        </div>

        {/* Bottom bar */}
        <div className="absolute bottom-8 left-14 right-14 z-10 flex items-center gap-4">
          <div className="bottom-line h-px flex-1 bg-white/10" />
          <span className="text-[10px] uppercase tracking-[0.2em] text-white/20">Powered by AI</span>
        </div>
      </div>

      {/* ── Right: login form ── */}
      <div className="flex flex-1 items-center justify-center bg-background px-6 py-12">
        <div className="form-card w-full max-w-[380px] rounded-2xl border border-border bg-card p-10 shadow-[0_2px_8px_rgba(0,0,0,0.04),0_16px_40px_rgba(0,0,0,0.06)]">
          {/* Logo */}
          <div className="mb-8 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-foreground text-sm font-bold text-background">
              W
            </div>
            <div>
              <div className="text-sm font-semibold text-foreground">LLM Wiki</div>
              <div className="text-[11px] text-muted-foreground">登录以继续</div>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div className="field-row flex flex-col gap-1.5">
              <label htmlFor="email" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                邮箱
              </label>
              <input
                id="email" type="email" autoComplete="email" required
                value={email} onChange={e => setEmail(e.target.value)}
                className="h-11 w-full rounded-xl border border-input bg-transparent px-4 text-sm outline-none transition-all placeholder:text-muted-foreground/40 focus-visible:border-foreground/20 focus-visible:ring-2 focus-visible:ring-foreground/5"
                placeholder="you@example.com"
              />
            </div>

            <div className="field-row flex flex-col gap-1.5">
              <label htmlFor="password" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                密码
              </label>
              <input
                id="password" type="password" autoComplete="current-password" required
                value={password} onChange={e => setPassword(e.target.value)}
                className="h-11 w-full rounded-xl border border-input bg-transparent px-4 text-sm outline-none transition-all placeholder:text-muted-foreground/40 focus-visible:border-foreground/20 focus-visible:ring-2 focus-visible:ring-foreground/5"
                placeholder="••••••••"
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <button
              type="submit" disabled={loading}
              className="form-btn mt-2 h-11 w-full rounded-xl bg-foreground text-sm font-medium text-background transition-all hover:opacity-90 hover:shadow-lg active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50"
            >
              {loading ? '登录中...' : '登录'}
            </button>
          </form>

          <p className="form-footer mt-8 text-center text-sm text-muted-foreground">
            没有账号？{' '}
            <Link to="/register" className="font-medium text-foreground underline-offset-4 hover:underline">
              注册
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
