import { useState, useEffect } from "react"
import { BrowserRouter, Routes, Route, Navigate, useParams, useNavigate } from "react-router-dom"
import i18n from "@/i18n"
import { useWikiStore } from "@/stores/wiki-store"
import { useReviewStore } from "@/stores/review-store"
import { useChatStore } from "@/stores/chat-store"
import { listDirectory, openProject } from "@/commands/fs"
import { getLastProject, getRecentProjects, saveLastProject, loadLlmConfig, loadLanguage, loadSearchApiConfig, loadEmbeddingConfig, loadMultimodalConfig, loadOutputLanguage, loadProviderConfigs, loadActivePresetId, loadProxyConfig } from "@/lib/project-store"
import { loadReviewItems, loadChatHistory } from "@/lib/persist"
import { setupAutoSave } from "@/lib/auto-save"
import { startClipWatcher } from "@/lib/clip-watcher"
import { AppLayout } from "@/components/layout/app-layout"
import { WelcomeScreen } from "@/components/project/welcome-screen"
import { CreateProjectDialog } from "@/components/project/create-project-dialog"
import { AuthGuard } from "@/components/auth/AuthGuard"
import { useAuthStore } from "@/stores/auth-store"
import { useOrgStore } from "@/stores/org-store"
import { httpGet } from "@/api/dotnet-client"
import { isSuperAdminFromToken } from "@/lib/auth-utils"
import { LoginPage } from "@/pages/LoginPage"
import { RegisterPage } from "@/pages/RegisterPage"
import { DeptSettingsPage } from "@/pages/DeptSettingsPage"
import { WikiDashboardPage } from "@/pages/WikiDashboardPage"
import { ImageGenerationPage } from "@/pages/ImageGenerationPage"

import type { WikiProject } from "@/types/wiki"
import type { ProjectLlmSettings } from "@/lib/project-llm-settings"

function hasPersistableProjectLlmSettings(settings: ProjectLlmSettings): boolean {
  return settings.activePresetId !== null
    || Object.keys(settings.providerConfigs).length > 0
    || !!settings.llmConfig.apiKey
    || !!settings.llmConfig.model
    || !!settings.llmConfig.customEndpoint
}

function App() {
  const IS_MULTI_TENANT = import.meta.env.VITE_MULTI_TENANT === 'true'
  const project = useWikiStore((s) => s.project)
  const setProject = useWikiStore((s) => s.setProject)
  const setFileTree = useWikiStore((s) => s.setFileTree)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [loading, setLoading] = useState(true)

  // Set up auto-save and clip watcher once on mount
  useEffect(() => {
    setupAutoSave()
    startClipWatcher()
  }, [])

  // Auto-open last project on startup
  useEffect(() => {
    async function init() {
      try {
        const savedConfig = await loadLlmConfig()
        if (savedConfig) {
          useWikiStore.getState().setLlmConfig(savedConfig)
        }
        const savedProviderConfigs = await loadProviderConfigs()
        if (savedProviderConfigs) {
          useWikiStore.getState().setProviderConfigs(savedProviderConfigs)
        }
        const savedActivePreset = await loadActivePresetId()
        if (savedActivePreset) {
          useWikiStore.getState().setActivePresetId(savedActivePreset)
          // Re-resolve the active preset's LlmConfig from (preset defaults
          // + saved overrides). Without this, preset default updates
          // (e.g. a corrected Anthropic model ID shipped in a release)
          // never reach users who are relying on defaults — their stored
          // `llmConfig` snapshot from a previous launch would keep the
          // old value. Overrides still win, so an explicit user choice
          // is preserved.
          const { LLM_PRESETS } = await import("@/components/settings/llm-presets")
          const { resolveConfig } = await import("@/components/settings/preset-resolver")
          const preset = LLM_PRESETS.find((p) => p.id === savedActivePreset)
          if (preset) {
            const currentFallback = useWikiStore.getState().llmConfig
            const override = (savedProviderConfigs ?? {})[savedActivePreset]
            const resolved = resolveConfig(preset, override, currentFallback)
            useWikiStore.getState().setLlmConfig(resolved)
            const { saveLlmConfig } = await import("@/lib/project-store")
            await saveLlmConfig(resolved)
          }
        }
        // If VITE_DEEPSEEK_API_KEY is set, inject it into both providerConfigs
        // (drives the settings UI display) and llmConfig (drives actual API calls).
        const envApiKey = import.meta.env.VITE_DEEPSEEK_API_KEY
        if (envApiKey) {
          const state = useWikiStore.getState()
          const existingOverride = state.providerConfigs["deepseek"] ?? {}
          if (!existingOverride.apiKey) {
            const newConfigs = {
              ...state.providerConfigs,
              deepseek: { ...existingOverride, apiKey: envApiKey },
            }
            state.setProviderConfigs(newConfigs)
          }
          if (!state.llmConfig.apiKey) {
            state.setLlmConfig({ ...state.llmConfig, apiKey: envApiKey })
          }
        }
        const savedSearchConfig = await loadSearchApiConfig()
        if (savedSearchConfig) {
          useWikiStore.getState().setSearchApiConfig(savedSearchConfig)
        }
        const savedEmbeddingConfig = await loadEmbeddingConfig()
        if (savedEmbeddingConfig) {
          useWikiStore.getState().setEmbeddingConfig(savedEmbeddingConfig)
        }
        const savedMultimodalConfig = await loadMultimodalConfig()
        if (savedMultimodalConfig) {
          useWikiStore.getState().setMultimodalConfig(savedMultimodalConfig)
        }
        const savedProxy = await loadProxyConfig()
        if (savedProxy) {
          useWikiStore.getState().setProxyConfig(savedProxy)
        }
        const savedLang = await loadLanguage()
        if (savedLang) {
          await i18n.changeLanguage(savedLang)
        }
        // 多租户模式下跳过单机项目自动恢复（项目由部门选择决定）
        if (!IS_MULTI_TENANT) {
          const lastProject = await getLastProject()
          if (lastProject) {
            try {
              const proj = await openProject(lastProject.path)
              await handleProjectOpened(proj)
            } catch {
              // Last project no longer valid
            }
          }
        }
      } catch {
        // ignore init errors
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [])

  async function handleProjectOpened(proj: WikiProject) {
    // Clear all per-project state BEFORE loading new project data
    // to prevent cross-project contamination. MUST be awaited so the
    // ingest queue / graph cache are actually cleared before the new
    // project's state is populated.
    const { resetProjectState } = await import("@/lib/reset-project-state")
    await resetProjectState()
    const {
      loadProjectLlmSettings,
      saveProjectLlmSettings,
    } = await import("@/lib/project-llm-settings")

    setProject(proj)
    const currentStore = useWikiStore.getState()
    const currentProjectLlmSettings: ProjectLlmSettings = {
      providerConfigs: currentStore.providerConfigs,
      activePresetId: currentStore.activePresetId,
      llmConfig: currentStore.llmConfig,
    }
    const persistedProjectLlmSettings = await loadProjectLlmSettings(proj.path)
    if (persistedProjectLlmSettings) {
      useWikiStore.getState().setProviderConfigs(persistedProjectLlmSettings.providerConfigs)
      useWikiStore.getState().setActivePresetId(persistedProjectLlmSettings.activePresetId)
      useWikiStore.getState().setLlmConfig(persistedProjectLlmSettings.llmConfig)
      const {
        saveProviderConfigs,
        saveActivePresetId,
        saveLlmConfig,
      } = await import("@/lib/project-store")
      await saveProviderConfigs(persistedProjectLlmSettings.providerConfigs)
      await saveActivePresetId(persistedProjectLlmSettings.activePresetId)
      await saveLlmConfig(persistedProjectLlmSettings.llmConfig)
    } else if (hasPersistableProjectLlmSettings(currentProjectLlmSettings)) {
      saveProjectLlmSettings(proj.path, currentProjectLlmSettings).catch((err) => {
        console.warn("Failed to migrate local LLM settings into project settings:", err)
      })
    }
    const projectOutputLang = await loadOutputLanguage(proj.id)
    useWikiStore.getState().setOutputLanguage(projectOutputLang ?? "auto")
    setSelectedFile(null)
    setActiveView("wiki")
    // Bump data version so any cached graphs/views invalidate
    useWikiStore.getState().bumpDataVersion()
    await saveLastProject(proj)

    // Restore ingest queue (resume interrupted tasks). Keyed by the
    // project's stable UUID so the queue still finds the right project
    // even if the filesystem path changed since the task was enqueued.
    import("@/lib/ingest-queue").then(({ restoreQueue }) => {
      restoreQueue(proj.id, proj.path).catch((err) =>
        console.error("Failed to restore ingest queue:", err)
      )
    })
    // Same handshake for the dedup-merge queue.
    import("@/lib/dedup-queue").then(({ restoreQueue }) => {
      restoreQueue(proj.id, proj.path).catch((err) =>
        console.error("Failed to restore dedup queue:", err)
      )
    })
    // Notify local clip server of the current project + all recent projects
    fetch("http://127.0.0.1:19827/project", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: proj.path }),
    }).catch(() => {})

    // Send all recent projects to clip server for extension project picker
    getRecentProjects().then((recents) => {
      const projects = recents.map((p) => ({ name: p.name, path: p.path }))
      fetch("http://127.0.0.1:19827/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projects }),
      }).catch(() => {})
    }).catch(() => {})
    try {
      const tree = await listDirectory(proj.path)
      setFileTree(tree)
    } catch (err) {
      console.error("Failed to load file tree:", err)
    }
    // Load persisted review items
    try {
      const savedReview = await loadReviewItems(proj.path)
      if (savedReview.length > 0) {
        useReviewStore.getState().setItems(savedReview)
      }
    } catch {
      // ignore, start fresh
    }
    // Load persisted chat history
    try {
      const savedChat = await loadChatHistory(proj.path)
      if (savedChat.conversations.length > 0) {
        useChatStore.getState().setConversations(savedChat.conversations)
        useChatStore.getState().setMessages(savedChat.messages)
        // Set most recent conversation as active
        const sorted = [...savedChat.conversations].sort((a, b) => b.updatedAt - a.updatedAt)
        if (sorted[0]) {
          useChatStore.getState().setActiveConversation(sorted[0].id)
        }
      }
    } catch {
      // ignore, start fresh
    }
  }

  async function handleSelectRecent(proj: WikiProject) {
    try {
      const validated = await openProject(proj.path)
      await handleProjectOpened(validated)
    } catch (err) {
      window.alert(`打开项目失败：${err}`)
    }
  }

  async function handleOpenProject() {
    const selected = window.prompt("请输入 Wiki 项目文件夹路径：")
    if (!selected || !selected.trim()) return
    try {
      const proj = await openProject(selected.trim())
      await handleProjectOpened(proj)
    } catch (err) {
      window.alert(`打开项目失败：${err}`)
    }
  }

  async function handleSwitchProject() {
    // Clear all per-project state BEFORE flipping back to the welcome screen
    // so old data cannot leak in via any async render pass.
    const { resetProjectState } = await import("@/lib/reset-project-state")
    await resetProjectState()
    setProject(null)
    setFileTree([])
    setSelectedFile(null)
  }

  if (IS_MULTI_TENANT) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route
            path="/d/:deptId/*"
            element={
              <AuthGuard requireDept>
                <DeptApp />
              </AuthGuard>
            }
          />
          <Route path="*" element={<RootRedirect />} />
        </Routes>
      </BrowserRouter>
    )
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-muted-foreground">
        加载中...
      </div>
    )
  }

  if (!project) {
    return (
      <>
        <WelcomeScreen
          onCreateProject={() => setShowCreateDialog(true)}
          onOpenProject={handleOpenProject}
          onSelectProject={handleSelectRecent}
        />
        <CreateProjectDialog
          open={showCreateDialog}
          onOpenChange={setShowCreateDialog}
          onCreated={handleProjectOpened}
        />
      </>
    )
  }

  return (
    <>
      <AppLayout onSwitchProject={handleSwitchProject} />
      <CreateProjectDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onCreated={handleProjectOpened}
      />
    </>
  )
}

// 根路由重定向：已登录 → 自动跳第一个部门，未登录 → 登录页
function RootRedirect() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const hasHydrated = useAuthStore((s) => s.hasHydrated)
  const navigate = useNavigate()
  const setOrgs = useOrgStore((s) => s.setOrgs)
  const setDepts = useOrgStore((s) => s.setDepts)
  const setActiveDeptId = useOrgStore((s) => s.setActiveDeptId)
  const [loading, setLoading] = useState(false)
  const [noDept, setNoDept] = useState(false)

  useEffect(() => {
    if (!hasHydrated || !isAuthenticated) return
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const orgs = await httpGet<{ id: string; name: string; slug: string }[]>('/api/orgs')
        const deptArrays = await Promise.all(
          orgs.map((o) =>
            httpGet<{ id: string; org_id: string; name: string; slug: string }[]>(`/api/orgs/${o.id}/departments`)
          )
        )
        if (cancelled) return
        const allDepts = deptArrays.flat()
        setOrgs(orgs.map((o) => ({ id: o.id, name: o.name, slug: o.slug })))
        setDepts(allDepts.map((d) => ({ id: d.id, orgId: d.org_id, name: d.name, slug: d.slug, wikiProjectPath: '' })))
        if (allDepts.length === 0) {
          setNoDept(true)
          return
        }
        setActiveDeptId(allDepts[0].id)
        navigate(`/d/${allDepts[0].id}`, { replace: true })
      } catch {
        if (!cancelled) setNoDept(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [hasHydrated, isAuthenticated, navigate, setOrgs, setDepts, setActiveDeptId])

  if (!hasHydrated) return null

  if (!isAuthenticated) return <Navigate to="/login" replace />

  if (loading) return (
    <div className="flex h-screen items-center justify-center text-muted-foreground text-sm">加载中...</div>
  )

  if (noDept) return (
    <div className="flex h-screen flex-col items-center justify-center gap-3 text-sm">
      <p className="text-muted-foreground">
        {isSuperAdminFromToken()
          ? '当前系统尚无部门，请先创建组织和部门后再继续。'
          : '您尚未加入任何部门，请联系管理员。'}
      </p>
      <button
        onClick={() => { useAuthStore.getState().clearAuth(); navigate('/login') }}
        className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-accent transition-colors"
      >
        退出登录
      </button>
    </div>
  )

  return null
}

// DeptApp: reads deptId from URL, fetches dept info, loads file tree, renders sub-routes.
// Must be defined outside App (hooks rules prohibit defining components inside another component).
function DeptApp() {
  const { deptId } = useParams<{ deptId: string }>()
  const navigate = useNavigate()
  const setProject = useWikiStore((s) => s.setProject)
  const setFileTree = useWikiStore((s) => s.setFileTree)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!deptId) return
    let cancelled = false

    async function loadDept() {
      try {
        // 1. 从后端获取部门信息（含真实 wiki 路径）
        const { httpGet } = await import("@/api/dotnet-client")
        const dept = await httpGet<{
          id: string; name: string; wiki_project_path: string
        }>(`/api/departments/${deptId}`)

        if (cancelled) return

        // 2. 设置项目
        const proj = { id: dept.id, name: dept.name, path: dept.wiki_project_path }
        setProject(proj)

        // 3. 注册到 project registry，使 ingest-queue 能通过 UUID 找到路径
        const { upsertProjectInfo } = await import("@/lib/project-identity")
        await upsertProjectInfo(proj.id, proj.path, proj.name)

        // 4. 初始化 ingest / dedup 队列（与单机 handleProjectOpened 保持一致）
        import("@/lib/ingest-queue").then(({ restoreQueue }) =>
          restoreQueue(proj.id, proj.path).catch(() => {})
        )
        import("@/lib/dedup-queue").then(({ restoreQueue }) =>
          restoreQueue(proj.id, proj.path).catch(() => {})
        )

        // 5. 加载文件树
        const { listDirectory } = await import("@/commands/fs")
        const tree = await listDirectory(dept.wiki_project_path)
        if (!cancelled) {
          setFileTree(tree)
          setReady(true)
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '加载失败')
      }
    }

    setReady(false)
    setError(null)
    loadDept()
    return () => { cancelled = true }
  }, [deptId, setProject, setFileTree])

  if (error) {
    return <div className="flex items-center justify-center h-screen text-destructive">{error}</div>
  }

  if (!ready) {
    return <div className="flex items-center justify-center h-screen text-muted-foreground">加载中...</div>
  }

  return (
    <Routes>
      <Route index element={
        <WikiDashboardPage
          deptId={deptId!}
          onEnterWiki={() => navigate(`/d/${deptId}/wiki`)}
        />
      } />
      <Route path="settings/*" element={<DeptSettingsPage />} />
      <Route path="images" element={<ImageGenerationPage deptId={deptId!} />} />
      <Route path="*" element={
        <AppLayout
          onSwitchProject={() => navigate(`/d/${deptId}`)}
          deptId={deptId}
          onDeptSettings={() => navigate(`/d/${deptId}/settings`)}
        />
      } />
    </Routes>
  )
}

export default App
