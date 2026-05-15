import { useState, useCallback } from 'react'
import { useNavigate, Link, Navigate } from 'react-router-dom'
import { httpPost } from '../api/dotnet-client'
import { useAuthStore } from '../stores/auth-store'

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

  // 已登录则直接跳到部门选择，不显示登录表单
  if (hasHydrated && isAuthenticated) {
    return <Navigate to="/select-dept" replace />
  }

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-8 shadow-sm">
        <h1 className="mb-6 text-center text-2xl font-semibold text-foreground">LLM Wiki 登录</h1>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-sm font-medium text-foreground">
              邮箱
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
              placeholder="you@example.com"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-sm font-medium text-foreground">
              密码
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-1 h-9 w-full rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
          >
            {loading ? '登录中...' : '登录'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          没有账号？{' '}
          <Link to="/register" className="font-medium text-primary underline-offset-4 hover:underline">
            注册
          </Link>
        </p>
      </div>
    </div>
  )
}
