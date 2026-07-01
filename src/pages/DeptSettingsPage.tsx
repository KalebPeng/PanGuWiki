import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  getImageGenerationConfig,
  httpDelete,
  httpGet,
  httpPost,
  httpPut,
  updateImageGenerationConfig,
  type ImageGenerationConfig,
} from '../api/dotnet-client'

// ── Types ─────────────────────────────────────────────────────────────────────

interface MemberResponse {
  id: string
  user_id: string
  email: string
  display_name: string
  role: string
  joined_at: string
}

type Role = 'admin' | 'editor' | 'viewer'

type TabKey = 'members' | 'roles' | 'modules' | 'image-generation'

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('zh-CN')
  } catch {
    return iso
  }
}

const ROLE_OPTIONS: Role[] = ['admin', 'editor', 'viewer']

const ROLE_LABELS: Record<Role, string> = {
  admin: '管理员',
  editor: '编辑者',
  viewer: '查看者',
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface MembersTabProps {
  deptId: string
  members: MemberResponse[]
  loading: boolean
  error: string | null
  onReload: () => void
}

function MembersTab({ deptId, members, loading, error, onReload }: MembersTabProps) {
  const [addEmail, setAddEmail] = useState('')
  const [addRole, setAddRole] = useState<Role>('viewer')
  const [addLoading, setAddLoading] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [deleteLoadingId, setDeleteLoadingId] = useState<string | null>(null)

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!addEmail.trim()) return
    setAddLoading(true)
    setAddError(null)
    try {
      await httpPost(`/api/departments/${deptId}/members`, { email: addEmail.trim(), role: addRole })
      setAddEmail('')
      setAddRole('viewer')
      onReload()
    } catch (err) {
      setAddError(err instanceof Error ? err.message : '添加成员失败')
    } finally {
      setAddLoading(false)
    }
  }

  async function handleDelete(userId: string) {
    if (!confirm(`确认移除该成员吗？`)) return
    setDeleteLoadingId(userId)
    try {
      await httpDelete(`/api/departments/${deptId}/members/${userId}`)
      onReload()
    } catch (err) {
      alert(err instanceof Error ? err.message : '删除成员失败')
    } finally {
      setDeleteLoadingId(null)
    }
  }

  return (
    <div className="space-y-6">
      {loading && <p className="text-sm text-muted-foreground">加载中...</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {!loading && !error && (
        <div className="overflow-hidden rounded-xl border border-border">
          {members.length === 0 ? (
            <p className="px-5 py-4 text-sm text-muted-foreground">暂无成员</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-5 py-3 text-left font-medium text-muted-foreground">成员</th>
                  <th className="px-5 py-3 text-left font-medium text-muted-foreground">角色</th>
                  <th className="px-5 py-3 text-left font-medium text-muted-foreground">加入时间</th>
                  <th className="px-5 py-3 text-right font-medium text-muted-foreground">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {members.map((m) => (
                  <tr key={m.id} className="bg-card hover:bg-accent/40 transition-colors">
                    <td className="px-5 py-3">
                      <div className="font-medium text-foreground">{m.display_name || '—'}</div>
                      <div className="text-xs text-muted-foreground">{m.email}</div>
                    </td>
                    <td className="px-5 py-3 text-foreground">
                      {ROLE_LABELS[m.role as Role] ?? m.role}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{formatDate(m.joined_at)}</td>
                    <td className="px-5 py-3 text-right">
                      <button
                        onClick={() => handleDelete(m.user_id)}
                        disabled={deleteLoadingId === m.user_id}
                        className="rounded-lg border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-destructive hover:text-destructive disabled:opacity-50"
                      >
                        {deleteLoadingId === m.user_id ? '移除中...' : '移除'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Add member form */}
      <div className="rounded-xl border border-border bg-card px-5 py-4">
        <h3 className="mb-3 text-sm font-semibold text-foreground">添加成员</h3>
        <form onSubmit={handleAdd} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="mb-1 block text-xs text-muted-foreground">邮箱</label>
            <input
              type="email"
              value={addEmail}
              onChange={(e) => setAddEmail(e.target.value)}
              placeholder="user@example.com"
              required
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">角色</label>
            <select
              value={addRole}
              onChange={(e) => setAddRole(e.target.value as Role)}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={addLoading}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {addLoading ? '添加中...' : '添加'}
          </button>
        </form>
        {addError && <p className="mt-2 text-xs text-destructive">{addError}</p>}
      </div>
    </div>
  )
}

// ── RolesTab ──────────────────────────────────────────────────────────────────

interface RolesTabProps {
  deptId: string
  members: MemberResponse[]
  loading: boolean
  error: string | null
  onReload: () => void
}

function RolesTab({ deptId, members, loading, error, onReload }: RolesTabProps) {
  const [savingId, setSavingId] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  async function handleRoleChange(userId: string, newRole: Role) {
    setSavingId(userId)
    setSaveError(null)
    try {
      await httpPut(`/api/departments/${deptId}/members/${userId}`, { role: newRole })
      onReload()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : '修改角色失败')
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="space-y-4">
      {loading && <p className="text-sm text-muted-foreground">加载中...</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {saveError && <p className="text-sm text-destructive">{saveError}</p>}

      {!loading && !error && (
        <div className="overflow-hidden rounded-xl border border-border">
          {members.length === 0 ? (
            <p className="px-5 py-4 text-sm text-muted-foreground">暂无成员</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-5 py-3 text-left font-medium text-muted-foreground">成员</th>
                  <th className="px-5 py-3 text-left font-medium text-muted-foreground">当前角色</th>
                  <th className="px-5 py-3 text-right font-medium text-muted-foreground">修改角色</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {members.map((m) => (
                  <tr key={m.id} className="bg-card hover:bg-accent/40 transition-colors">
                    <td className="px-5 py-3">
                      <div className="font-medium text-foreground">{m.display_name || '—'}</div>
                      <div className="text-xs text-muted-foreground">{m.email}</div>
                    </td>
                    <td className="px-5 py-3 text-foreground">
                      {ROLE_LABELS[m.role as Role] ?? m.role}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <select
                        defaultValue={m.role}
                        disabled={savingId === m.user_id}
                        onChange={(e) => handleRoleChange(m.user_id, e.target.value as Role)}
                        className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none disabled:opacity-50"
                      >
                        {ROLE_OPTIONS.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

// ── ModulesTab ────────────────────────────────────────────────────────────────

interface ModulesTabProps {
  deptId: string
}

function ModulesTab({ deptId }: ModulesTabProps) {
  const [migrating, setMigrating] = useState(false)
  const [migrateMessage, setMigrateMessage] = useState<string | null>(null)
  const [migrateError, setMigrateError] = useState<string | null>(null)

  async function handleMigrate() {
    setMigrating(true)
    setMigrateMessage(null)
    setMigrateError(null)
    try {
      const result = await httpPost<{ migrated_pages: number; message: string }>(
        `/api/departments/${deptId}/migrate`,
        {},
      )
      setMigrateMessage(result.message)
    } catch (err) {
      setMigrateError(err instanceof Error ? err.message : '迁移失败，请稍后重试')
    } finally {
      setMigrating(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-xl border border-border bg-card px-5 py-4">
        <div>
          <p className="text-sm font-medium text-foreground">Wiki</p>
          <p className="text-xs text-muted-foreground">知识库与文档管理</p>
        </div>
        <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
          已启用
        </span>
      </div>

      <div className="flex items-center justify-between rounded-xl border border-border bg-card px-5 py-4 opacity-60">
        <div>
          <p className="text-sm font-medium text-foreground">项目管理</p>
          <p className="text-xs text-muted-foreground">任务与项目跟踪</p>
        </div>
        <span className="rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground">
          即将推出
        </span>
      </div>

      {/* Data migration section */}
      <hr className="border-border" />

      <div className="rounded-xl border border-border bg-card px-5 py-4">
        <h3 className="mb-1 text-sm font-semibold text-foreground">数据迁移</h3>
        <p className="mb-4 text-xs text-muted-foreground">
          重建向量索引（清理旧格式数据）
        </p>

        <button
          onClick={handleMigrate}
          disabled={migrating}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {migrating ? '迁移中...' : '执行迁移'}
        </button>

        {migrateMessage && (
          <p className="mt-3 text-xs font-medium text-green-600 dark:text-green-400">
            {migrateMessage}
          </p>
        )}
        {migrateError && (
          <p className="mt-3 text-xs font-medium text-destructive">{migrateError}</p>
        )}
      </div>
    </div>
  )
}

// ── Embeddable content (no page wrapper) ──────────────────────────────────────

interface ImageGenerationSettingsTabProps {
  deptId: string
}

const IMAGE_SIZE_OPTIONS = [
  '1024x1024',
  '1024x1536',
  '1536x1024',
  '9:16',
  '2:3',
  '3:4',
  '4:5',
  '1:1',
  '5:4',
  '4:3',
  '3:2',
  '16:9',
  '21:9',
  '9:21',
  '1:2',
  '2:1',
] as const

const EMPTY_IMAGE_CONFIG: Omit<ImageGenerationConfig, 'id'> = {
  enabled: false,
  base_url: '',
  has_api_key: false,
  model: 'gpt-image-1',
  default_size: '1024x1024',
}

function ImageGenerationSettingsTab({ deptId }: ImageGenerationSettingsTabProps) {
  const [config, setConfig] = useState<Omit<ImageGenerationConfig, 'id'> & { id?: string }>(EMPTY_IMAGE_CONFIG)
  const [apiKey, setApiKey] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadConfig() {
      setLoading(true)
      setError(null)
      try {
        const data = await getImageGenerationConfig(deptId)
        if (!cancelled) setConfig(data)
      } catch {
        if (!cancelled) setConfig(EMPTY_IMAGE_CONFIG)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadConfig()
    return () => {
      cancelled = true
    }
  }, [deptId])

  async function handleSave(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      const updated = await updateImageGenerationConfig(deptId, {
        enabled: config.enabled,
        base_url: config.base_url.trim(),
        api_key: apiKey.trim() || null,
        model: config.model.trim() || 'gpt-image-1',
        default_size: config.default_size,
      })
      setConfig(updated)
      setApiKey('')
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存图片生成配置失败')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">加载图片生成配置中...</p>
  }

  return (
    <form onSubmit={handleSave} className="space-y-5">
      <div className="rounded-xl border border-border bg-card px-5 py-4">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground">AI 图片生成</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              配置 OpenAI Images 兼容中转站。生成结果会保存到当前账号的素材库，不会写入 Wiki 文件目录。
            </p>
          </div>
          <label className="flex shrink-0 items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(event) => setConfig((current) => ({ ...current, enabled: event.target.checked }))}
              className="h-4 w-4 rounded border-border"
            />
            启用
          </label>
        </div>

        <div className="grid gap-4">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">中转站地址</label>
            <input
              value={config.base_url}
              onChange={(event) => setConfig((current) => ({ ...current, base_url: event.target.value }))}
              placeholder="https://your-relay.example.com"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">模型</label>
              <input
                value={config.model}
                onChange={(event) => setConfig((current) => ({ ...current, model: event.target.value }))}
                placeholder="gpt-image-1"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs text-muted-foreground">默认尺寸</label>
              <select
                value={config.default_size}
                onChange={(event) => setConfig((current) => ({ ...current, default_size: event.target.value }))}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
              >
                {IMAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>{size}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs text-muted-foreground">API Key</label>
            <input
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              type="password"
              placeholder={config.has_api_key ? '已保存；留空则继续使用原密钥' : '输入中转站 API Key'}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {config.has_api_key ? '当前已保存密钥。只有填写新密钥时才会覆盖。' : '启用前需要保存一个可用密钥。'}
            </p>
          </div>
        </div>

        {error && <p className="mt-3 text-xs font-medium text-destructive">{error}</p>}
        {saved && <p className="mt-3 text-xs font-medium text-green-600 dark:text-green-400">已保存图片生成配置</p>}
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {saving ? '保存中...' : '保存配置'}
        </button>
      </div>
    </form>
  )
}

export function DeptSettingsContent({ deptId }: { deptId: string }) {
  const [activeTab, setActiveTab] = useState<TabKey>('members')
  const [members, setMembers] = useState<MemberResponse[]>([])
  const [membersLoading, setMembersLoading] = useState(true)
  const [membersError, setMembersError] = useState<string | null>(null)

  const loadMembers = useCallback(async () => {
    if (!deptId) return
    setMembersLoading(true)
    setMembersError(null)
    try {
      const data = await httpGet<MemberResponse[]>(`/api/departments/${deptId}/members`)
      setMembers(data)
    } catch (err) {
      setMembersError(err instanceof Error ? err.message : '加载成员失败，请刷新重试')
    } finally {
      setMembersLoading(false)
    }
  }, [deptId])

  useEffect(() => { loadMembers() }, [loadMembers])

  const TABS: { key: TabKey; label: string }[] = [
    { key: 'members', label: '成员管理' },
    { key: 'roles', label: '角色分配' },
    { key: 'modules', label: '模块开关' },
    { key: 'image-generation', label: 'AI 图片生成' },
  ]

  return (
    <>
      <div className="mb-6 flex gap-1 rounded-xl border border-border bg-muted/30 p-1">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={[
              'flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
              activeTab === tab.key
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            ].join(' ')}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'members' && (
        <MembersTab deptId={deptId} members={members} loading={membersLoading} error={membersError} onReload={loadMembers} />
      )}
      {activeTab === 'roles' && (
        <RolesTab deptId={deptId} members={members} loading={membersLoading} error={membersError} onReload={loadMembers} />
      )}
      {activeTab === 'modules' && <ModulesTab deptId={deptId} />}
      {activeTab === 'image-generation' && <ImageGenerationSettingsTab deptId={deptId} />}
    </>
  )
}

// ── Standalone page (kept for direct URL access) ───────────────────────────────

export function DeptSettingsPage() {
  const { deptId } = useParams<{ deptId: string }>()

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center gap-4 border-b border-border px-6 py-4">
        <Link
          to={`/d/${deptId}/wiki`}
          className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          返回 Wiki
        </Link>
        <h1 className="text-lg font-semibold text-foreground">部门设置</h1>
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
        <DeptSettingsContent deptId={deptId ?? ''} />
      </main>
    </div>
  )
}
