import { useEffect, useState, useCallback } from 'react'
import { httpGet, httpPatch } from '../../api/dotnet-client'

interface AdminUser {
  id: string
  email: string
  display_name: string
  is_active: boolean
  is_super_admin: boolean
  created_at: string
}

export function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await httpGet<AdminUser[]>('/api/admin/users')
      setUsers(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function toggle(userId: string, field: 'is_active' | 'is_super_admin', current: boolean) {
    try {
      await httpPatch(`/api/admin/users/${userId}`, { [field]: !current })
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, [field]: !current } : u))
    } catch (e) {
      alert(e instanceof Error ? e.message : '操作失败')
    }
  }

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold">用户管理</h1>

      {loading && <p className="text-muted-foreground text-sm">加载中...</p>}
      {error && <p className="text-destructive text-sm">{error}</p>}

      {!loading && !error && (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                {['邮箱', '显示名', '状态', '超级管理员', '注册时间', '操作'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map(u => (
                <tr key={u.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3 font-mono text-xs">{u.email}</td>
                  <td className="px-4 py-3">{u.display_name}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                      u.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}>
                      {u.is_active ? '激活' : '禁用'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                      u.is_super_admin ? 'bg-purple-100 text-purple-700' : 'bg-muted text-muted-foreground'
                    }`}>
                      {u.is_super_admin ? '是' : '否'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(u.created_at).toLocaleDateString('zh-CN')}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button
                        onClick={() => toggle(u.id, 'is_active', u.is_active)}
                        className="rounded px-2 py-1 text-xs border border-border hover:bg-accent transition-colors"
                      >
                        {u.is_active ? '禁用' : '激活'}
                      </button>
                      <button
                        onClick={() => toggle(u.id, 'is_super_admin', u.is_super_admin)}
                        className="rounded px-2 py-1 text-xs border border-border hover:bg-accent transition-colors"
                      >
                        {u.is_super_admin ? '取消超管' : '设为超管'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
