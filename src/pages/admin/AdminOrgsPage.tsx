import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { httpGet, httpPost, httpDelete } from '../../api/dotnet-client'

interface AdminOrg {
  id: string
  name: string
  slug: string
  owner_id: string
  dept_count: number
  created_at: string
}

export function AdminOrgsPage() {
  const navigate = useNavigate()
  const [orgs, setOrgs] = useState<AdminOrg[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 创建表单
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [creating, setCreating] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await httpGet<AdminOrg[]>('/api/admin/orgs')
      setOrgs(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    setFormError(null)
    try {
      await httpPost('/api/admin/orgs', { name, slug, owner_email: ownerEmail })
      setName(''); setSlug(''); setOwnerEmail(''); setShowForm(false)
      load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : '创建失败')
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete(org: AdminOrg) {
    if (!confirm(`确认删除组织「${org.name}」？其下所有部门和成员关系将一并删除。`)) return
    try {
      await httpDelete(`/api/admin/orgs/${org.id}`)
      setOrgs(prev => prev.filter(o => o.id !== org.id))
    } catch (e) {
      alert(e instanceof Error ? e.message : '删除失败')
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">组织管理</h1>
        <button
          onClick={() => setShowForm(v => !v)}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          + 新建组织
        </button>
      </div>

      {/* 创建表单 */}
      {showForm && (
        <form onSubmit={handleCreate} className="mb-6 rounded-xl border border-border bg-card p-5 space-y-4">
          <h2 className="text-sm font-semibold">新建组织</h2>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">组织名称</label>
              <input value={name} onChange={e => setName(e.target.value)} required
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Slug（小写字母/数字/连字符）</label>
              <input value={slug} onChange={e => setSlug(e.target.value)} required
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Owner 邮箱</label>
              <input type="email" value={ownerEmail} onChange={e => setOwnerEmail(e.target.value)} required
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
            </div>
          </div>
          {formError && <p className="text-xs text-destructive">{formError}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={creating}
              className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50">
              {creating ? '创建中...' : '确认创建'}
            </button>
            <button type="button" onClick={() => setShowForm(false)}
              className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-accent">
              取消
            </button>
          </div>
        </form>
      )}

      {loading && <p className="text-muted-foreground text-sm">加载中...</p>}
      {error && <p className="text-destructive text-sm">{error}</p>}

      {!loading && !error && (
        <div className="space-y-3">
          {orgs.length === 0 && <p className="text-sm text-muted-foreground">暂无组织</p>}
          {orgs.map(org => (
            <div key={org.id} className="flex items-center justify-between rounded-xl border border-border bg-card px-5 py-4">
              <div>
                <p className="font-medium">{org.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {org.slug} · {org.dept_count} 个部门 · {new Date(org.created_at).toLocaleDateString('zh-CN')}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => navigate(`/admin/orgs/${org.id}`)}
                  className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent transition-colors"
                >
                  管理部门
                </button>
                <button
                  onClick={() => handleDelete(org)}
                  className="rounded-lg border border-destructive/40 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10 transition-colors"
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
