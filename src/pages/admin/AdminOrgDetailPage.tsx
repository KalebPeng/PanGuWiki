import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { httpGet, httpPost, httpPut, httpDelete } from '../../api/dotnet-client'

interface AdminDept {
  id: string
  org_id: string
  name: string
  slug: string
  wiki_project_path: string
  member_count: number
  created_at: string
}

interface AdminMember {
  id: string
  user_id: string
  email: string
  display_name: string
  role: string
  joined_at: string
}

const ROLES = ['admin', 'editor', 'viewer']

export function AdminOrgDetailPage() {
  const { orgId } = useParams<{ orgId: string }>()
  const [depts, setDepts] = useState<AdminDept[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 展开的部门成员
  const [expandedDeptId, setExpandedDeptId] = useState<string | null>(null)
  const [members, setMembers] = useState<AdminMember[]>([])
  const [membersLoading, setMembersLoading] = useState(false)

  // 创建部门表单
  const [showDeptForm, setShowDeptForm] = useState(false)
  const [deptName, setDeptName] = useState('')
  const [deptSlug, setDeptSlug] = useState('')
  const [creating, setCreating] = useState(false)
  const [deptFormError, setDeptFormError] = useState<string | null>(null)

  // 添加成员表单
  const [memberEmail, setMemberEmail] = useState('')
  const [memberRole, setMemberRole] = useState('editor')
  const [addingMember, setAddingMember] = useState(false)
  const [memberError, setMemberError] = useState<string | null>(null)

  const loadDepts = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    setError(null)
    try {
      const data = await httpGet<AdminDept[]>(`/api/admin/orgs/${orgId}/departments`)
      setDepts(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => { loadDepts() }, [loadDepts])

  async function loadMembers(deptId: string) {
    setMembersLoading(true)
    setMemberError(null)
    try {
      const data = await httpGet<AdminMember[]>(`/api/admin/departments/${deptId}/members`)
      setMembers(data)
    } catch (e) {
      setMemberError(e instanceof Error ? e.message : '加载成员失败')
    } finally {
      setMembersLoading(false)
    }
  }

  function toggleDept(deptId: string) {
    if (expandedDeptId === deptId) {
      setExpandedDeptId(null)
    } else {
      setExpandedDeptId(deptId)
      loadMembers(deptId)
    }
  }

  async function handleCreateDept(e: React.FormEvent) {
    e.preventDefault()
    if (!orgId) return
    setCreating(true)
    setDeptFormError(null)
    try {
      await httpPost(`/api/admin/orgs/${orgId}/departments`, {
        name: deptName, slug: deptSlug
      })
      setDeptName(''); setDeptSlug(''); setShowDeptForm(false)
      loadDepts()
    } catch (e) {
      setDeptFormError(e instanceof Error ? e.message : '创建失败')
    } finally {
      setCreating(false)
    }
  }

  async function handleDeleteDept(dept: AdminDept) {
    if (!confirm(`确认删除部门「${dept.name}」？成员关系将一并删除。`)) return
    try {
      await httpDelete(`/api/admin/departments/${dept.id}`)
      setDepts(prev => prev.filter(d => d.id !== dept.id))
      if (expandedDeptId === dept.id) setExpandedDeptId(null)
    } catch (e) {
      alert(e instanceof Error ? e.message : '删除失败')
    }
  }

  async function handleAddMember(e: React.FormEvent) {
    e.preventDefault()
    if (!expandedDeptId) return
    setAddingMember(true)
    setMemberError(null)
    try {
      await httpPost(`/api/admin/departments/${expandedDeptId}/members`, {
        email: memberEmail, role: memberRole
      })
      setMemberEmail('')
      loadMembers(expandedDeptId)
    } catch (e) {
      setMemberError(e instanceof Error ? e.message : '添加失败')
    } finally {
      setAddingMember(false)
    }
  }

  async function handleChangeRole(deptId: string, userId: string, role: string) {
    try {
      await httpPut(`/api/admin/departments/${deptId}/members/${userId}`, { role })
      setMembers(prev => prev.map(m => m.user_id === userId ? { ...m, role } : m))
    } catch (e) {
      alert(e instanceof Error ? e.message : '修改失败')
    }
  }

  async function handleRemoveMember(deptId: string, userId: string) {
    if (!confirm('确认移除该成员？')) return
    try {
      await httpDelete(`/api/admin/departments/${deptId}/members/${userId}`)
      setMembers(prev => prev.filter(m => m.user_id !== userId))
    } catch (e) {
      alert(e instanceof Error ? e.message : '移除失败')
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">部门管理</h1>
        <button
          onClick={() => setShowDeptForm(v => !v)}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          + 新建部门
        </button>
      </div>

      {/* 创建部门表单 */}
      {showDeptForm && (
        <form onSubmit={handleCreateDept} className="mb-6 rounded-xl border border-border bg-card p-5 space-y-4">
          <h2 className="text-sm font-semibold">新建部门</h2>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">部门名称</label>
              <input value={deptName} onChange={e => setDeptName(e.target.value)} required
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Slug</label>
              <input value={deptSlug} onChange={e => setDeptSlug(e.target.value)} required
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
            </div>
          </div>
          {deptFormError && <p className="text-xs text-destructive">{deptFormError}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={creating}
              className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50">
              {creating ? '创建中...' : '确认创建'}
            </button>
            <button type="button" onClick={() => setShowDeptForm(false)}
              className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-accent">
              取消
            </button>
          </div>
        </form>
      )}

      {loading && <p className="text-sm text-muted-foreground">加载中...</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {!loading && !error && (
        <div className="space-y-3">
          {depts.length === 0 && <p className="text-sm text-muted-foreground">暂无部门</p>}
          {depts.map(dept => (
            <div key={dept.id} className="rounded-xl border border-border bg-card overflow-hidden">
              {/* 部门头 */}
              <div className="flex items-center justify-between px-5 py-4">
                <div>
                  <p className="font-medium">{dept.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {dept.slug} · {dept.member_count} 名成员 · {dept.wiki_project_path}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => toggleDept(dept.id)}
                    className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent transition-colors"
                  >
                    {expandedDeptId === dept.id ? '收起成员' : '管理成员'}
                  </button>
                  <button
                    onClick={() => handleDeleteDept(dept)}
                    className="rounded-lg border border-destructive/40 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    删除
                  </button>
                </div>
              </div>

              {/* 成员区 */}
              {expandedDeptId === dept.id && (
                <div className="border-t border-border bg-muted/20 px-5 py-4 space-y-4">
                  {membersLoading && <p className="text-xs text-muted-foreground">加载成员...</p>}
                  {memberError && <p className="text-xs text-destructive">{memberError}</p>}

                  {!membersLoading && members.length > 0 && (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-muted-foreground">
                          <th className="pb-2">邮箱</th>
                          <th className="pb-2">显示名</th>
                          <th className="pb-2">角色</th>
                          <th className="pb-2">加入时间</th>
                          <th className="pb-2">操作</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {members.map(m => (
                          <tr key={m.user_id}>
                            <td className="py-2 font-mono text-xs">{m.email}</td>
                            <td className="py-2">{m.display_name}</td>
                            <td className="py-2">
                              <select
                                value={m.role}
                                onChange={e => handleChangeRole(dept.id, m.user_id, e.target.value)}
                                className="rounded border border-border bg-background px-2 py-0.5 text-xs"
                              >
                                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                              </select>
                            </td>
                            <td className="py-2 text-muted-foreground text-xs">
                              {new Date(m.joined_at).toLocaleDateString('zh-CN')}
                            </td>
                            <td className="py-2">
                              <button
                                onClick={() => handleRemoveMember(dept.id, m.user_id)}
                                className="text-xs text-destructive hover:underline"
                              >
                                移除
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

                  {!membersLoading && members.length === 0 && (
                    <p className="text-xs text-muted-foreground">暂无成员</p>
                  )}

                  {/* 添加成员 */}
                  <form onSubmit={handleAddMember} className="flex gap-2 items-end">
                    <div>
                      <label className="mb-1 block text-xs text-muted-foreground">邮箱</label>
                      <input
                        type="email" value={memberEmail}
                        onChange={e => setMemberEmail(e.target.value)} required
                        className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-muted-foreground">角色</label>
                      <select value={memberRole} onChange={e => setMemberRole(e.target.value)}
                        className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm">
                        {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                    <button type="submit" disabled={addingMember}
                      className="rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50">
                      {addingMember ? '添加中...' : '添加成员'}
                    </button>
                  </form>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
