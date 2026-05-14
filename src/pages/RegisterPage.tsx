import { useState, useCallback } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { httpPost } from '../api/dotnet-client'
import { useAuthStore } from '../stores/auth-store'

interface RegisterResponse {
  access_token: string
  refresh_token: string
  user: { id: string; email: string; display_name: string }
}

export function RegisterPage() {
  const navigate = useNavigate()
  const setAuth = useAuthStore(s => s.setAuth)

  const [displayName, setDisplayName] = useState('')
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
        const data = await httpPost<RegisterResponse>('/api/auth/register', {
          email,
          password,
          display_name: displayName,
        })
        if (data.refresh_token) {
          localStorage.setItem('llmwiki:auth:refresh_token', data.refresh_token)
        }
        setAuth(
          { id: data.user.id, email: data.user.email, displayName: data.user.display_name },
          data.access_token
        )
        navigate('/select-dept', { replace: true })
      } catch (err) {
        setError(err instanceof Error ? err.message : '注册失败，请稍后重试')
      } finally {
        setLoading(false)
      }
    },
    [email, password, displayName, setAuth, navigate]
  )

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-8 shadow-sm">
        <h1 className="mb-6 text-center text-2xl font-semibold text-foreground">LLM Wiki 注册</h1>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="display-name" className="text-sm font-medium text-foreground">
              显示名称
            </label>
            <input
              id="display-name"
              type="text"
              autoComplete="name"
              required
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              className="h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
              placeholder="张三"
            />
          </div>

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
              autoComplete="new-password"
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
            {loading ? '注册中...' : '注册'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          已有账号？{' '}
          <Link to="/login" className="font-medium text-primary underline-offset-4 hover:underline">
            登录
          </Link>
        </p>
      </div>
    </div>
  )
}
