import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { isSuperAdminFromToken } from '../lib/auth-utils'
import { httpGet } from '../api/dotnet-client'
import { useAuthStore } from '../stores/auth-store'
import { useOrgStore, type Org, type Dept } from '../stores/org-store'

interface OrgResponse {
  id: string
  name: string
  slug: string
}

interface DeptResponse {
  id: string
  org_id: string
  name: string
  slug: string
}

export function DeptSelectPage() {
  const navigate = useNavigate()

  const user = useAuthStore(s => s.user)
  const clearAuth = useAuthStore(s => s.clearAuth)

  const setOrgs = useOrgStore(s => s.setOrgs)
  const setDepts = useOrgStore(s => s.setDepts)
  const setActiveDeptId = useOrgStore(s => s.setActiveDeptId)
  const clearOrg = useOrgStore(s => s.clearOrg)
  const orgs = useOrgStore(s => s.orgs)
  const depts = useOrgStore(s => s.depts)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function fetchOrgsAndDepts() {
      setLoading(true)
      setError(null)
      try {
        const orgResponses = await httpGet<OrgResponse[]>('/api/orgs')

        const mappedOrgs: Org[] = orgResponses.map(o => ({
          id: o.id,
          name: o.name,
          slug: o.slug,
        }))

        const deptArrays = await Promise.all(
          orgResponses.map(o =>
            httpGet<DeptResponse[]>(`/api/orgs/${o.id}/departments`)
          )
        )

        const allDepts: Dept[] = deptArrays.flat().map(d => ({
          id: d.id,
          orgId: d.org_id,
          name: d.name,
          slug: d.slug,
          wikiProjectPath: '',
        }))

        if (!cancelled) {
          setOrgs(mappedOrgs)
          setDepts(allDepts)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '加载组织信息失败，请刷新重试')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    fetchOrgsAndDepts()
    return () => {
      cancelled = true
    }
  }, [setOrgs, setDepts])

  function handleSelectDept(dept: Dept) {
    setActiveDeptId(dept.id)
    navigate(`/d/${dept.id}/wiki`)
  }

  function handleLogout() {
    clearAuth()
    clearOrg()
    navigate('/login')
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <p className="text-sm text-foreground">
          欢迎，<span className="font-semibold">{user?.displayName}</span>
        </p>
        <div className="flex items-center gap-3">
          {isSuperAdminFromToken() && (
            <Link
              to="/admin"
              className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent"
            >
              系统管理
            </Link>
          )}
          <button
            onClick={handleLogout}
            className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-destructive hover:text-destructive"
          >
            退出登录
          </button>
        </div>
      </header>

      {/* Main content */}
      <main className="flex flex-1 flex-col items-center px-4 py-12">
        <h1 className="mb-8 text-2xl font-semibold text-foreground">选择部门</h1>

        {loading && (
          <p className="text-sm text-muted-foreground">加载中...</p>
        )}

        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        {!loading && !error && depts.length === 0 && (
          <p className="text-sm text-muted-foreground">您尚未加入任何部门，请联系管理员</p>
        )}

        {!loading && !error && depts.length > 0 && (
          <div className="w-full max-w-2xl space-y-8">
            {orgs.map(org => {
              const orgDepts = depts.filter(d => d.orgId === org.id)
              if (orgDepts.length === 0) return null
              return (
                <section key={org.id}>
                  <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {org.name}
                  </h2>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {orgDepts.map(dept => (
                      <button
                        key={dept.id}
                        onClick={() => handleSelectDept(dept)}
                        className="flex flex-col gap-1 rounded-xl border border-border bg-card px-5 py-4 text-left transition-colors hover:border-primary hover:bg-accent"
                      >
                        <span className="font-medium text-foreground">{dept.name}</span>
                        <span className="text-xs text-muted-foreground">{org.name}</span>
                      </button>
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
