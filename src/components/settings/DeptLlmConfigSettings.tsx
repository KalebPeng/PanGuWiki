import { useState, useEffect } from "react"
import { CheckCircle2, Loader2, ServerCog } from "lucide-react"
import { httpGet, httpPut } from "@/api/dotnet-client"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useOrgStore } from "@/stores/org-store"

interface LlmConfigResponse {
  id: string
  provider: string
  endpoint: string
  has_api_key: boolean
  model: string
  api_mode?: string
  max_context_size: number
  is_active: boolean
}

const PROVIDERS = [
  { value: "openai", label: "OpenAI / 兼容" },
  { value: "anthropic", label: "Anthropic" },
  { value: "gemini", label: "Google Gemini" },
  { value: "ollama", label: "Ollama（本地）" },
]

export function DeptLlmConfigSettings() {
  const activeDeptId = useOrgStore((s) => s.activeDeptId)
  const activeDept = useOrgStore((s) => s.activeDept)

  const [config, setConfig] = useState<LlmConfigResponse | null>(null)
  const [form, setForm] = useState({
    provider: "openai",
    endpoint: "",
    apiKey: "",
    model: "",
    maxContextSize: 32000,
  })
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [keyWarning, setKeyWarning] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (!activeDeptId) return
    setLoading(true)
    httpGet<LlmConfigResponse>(`/api/departments/${activeDeptId}/llm-config`)
      .then((cfg) => {
        setConfig(cfg)
        setForm({
          provider: cfg.provider,
          endpoint: cfg.endpoint,
          apiKey: "",
          model: cfg.model,
          maxContextSize: cfg.max_context_size,
        })
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [activeDeptId])

  if (!activeDeptId) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-sm text-muted-foreground">
        <ServerCog className="h-8 w-8 opacity-30" />
        <span>请先选择部门以管理部门 LLM 配置</span>
      </div>
    )
  }

  const needsApiKey = form.provider !== "ollama"
  const apiKeyMissing = needsApiKey && !form.apiKey && !config?.has_api_key

  const handleSave = async () => {
    if (apiKeyMissing) {
      setKeyWarning(true)
      return
    }
    setKeyWarning(false)
    setSaveError(null)
    setSaving(true)
    try {
      const updated = await httpPut<LlmConfigResponse>(
        `/api/departments/${activeDeptId}/llm-config`,
        {
          provider: form.provider,
          endpoint: form.endpoint,
          api_key: form.apiKey,
          model: form.model,
          max_context_size: form.maxContextSize,
        },
      )
      setConfig(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : '保存失败，请重试')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2">
        <div>
          <p className="text-sm text-muted-foreground">
            当前部门：
            <span className="font-medium text-foreground">{activeDept?.name ?? activeDeptId}</span>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            此配置为部门 Ingest Worker 的默认 LLM，成员个人配置优先级更高。留空 API Key 则保留已存储的密钥。
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          加载中…
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Provider</Label>
            <select
              value={form.provider}
              onChange={(e) => setForm({ ...form, provider: e.target.value })}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label>Endpoint</Label>
            <Input
              value={form.endpoint}
              onChange={(e) => setForm({ ...form, endpoint: e.target.value })}
              placeholder="https://api.openai.com"
            />
            <p className="text-[11px] text-muted-foreground">填写 Base URL，无需带 /v1</p>
          </div>

          {needsApiKey && (
            <div className="space-y-1.5">
              <Label>
                API Key{" "}
                {config?.has_api_key && (
                  <span className="text-emerald-600 dark:text-emerald-400">（已配置）</span>
                )}
              </Label>
              <Input
                type="password"
                value={form.apiKey}
                onChange={(e) => {
                  setForm({ ...form, apiKey: e.target.value })
                  setKeyWarning(false)
                }}
                placeholder={config?.has_api_key ? "留空保留现有密钥" : "sk-…"}
                className={keyWarning ? "border-destructive ring-destructive/30 focus:ring-destructive" : ""}
              />
              {keyWarning && (
                <p className="text-[11px] text-destructive">Ollama 以外的 provider 需要 API Key</p>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Model</Label>
            <Input
              value={form.model}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
              placeholder="gpt-4o"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Max Context Size</Label>
            <Input
              type="number"
              value={form.maxContextSize}
              onChange={(e) =>
                setForm({ ...form, maxContextSize: parseInt(e.target.value) || 32000 })
              }
            />
          </div>
        </div>
      )}

      {saveError && (
        <p className="text-[12px] text-destructive">{saveError}</p>
      )}
      <button
        onClick={handleSave}
        disabled={saving || loading}
        className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            保存中…
          </>
        ) : saved ? (
          <>
            <CheckCircle2 className="h-3.5 w-3.5" />
            已保存
          </>
        ) : (
          "保存部门配置"
        )}
      </button>
    </div>
  )
}
