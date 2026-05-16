import { useState, useEffect } from "react"
import { httpGet, httpPut } from "@/api/dotnet-client"

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

export function UserLlmConfigSettings() {
  const [config, setConfig] = useState<LlmConfigResponse | null>(null)
  const [form, setForm] = useState({
    provider: "openai",
    endpoint: "",
    apiKey: "",
    model: "",
    maxContextSize: 32000,
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    httpGet<LlmConfigResponse>("/api/llm-configs/me")
      .then((cfg) => {
        setConfig(cfg)
        setForm({
          provider: cfg.provider,
          endpoint: cfg.endpoint,
          apiKey: "",  // never echo the key
          model: cfg.model,
          maxContextSize: cfg.max_context_size,
        })
      })
      .catch(() => {})  // 404 = not configured, show empty form
  }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      const updated = await httpPut<LlmConfigResponse>("/api/llm-configs/me", {
        provider: form.provider,
        endpoint: form.endpoint,
        api_key: form.apiKey,
        model: form.model,
        max_context_size: form.maxContextSize,
      })
      setConfig(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium">个人 LLM 配置（优先于部门配置）</h3>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-xs">
          Provider
          <select
            value={form.provider}
            onChange={(e) => setForm({ ...form, provider: e.target.value })}
            className="border rounded px-2 py-1"
          >
            <option value="openai">OpenAI / 兼容</option>
            <option value="anthropic">Anthropic</option>
            <option value="ollama">Ollama</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Endpoint
          <input
            value={form.endpoint}
            onChange={(e) => setForm({ ...form, endpoint: e.target.value })}
            placeholder="https://api.openai.com"
            className="border rounded px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          API Key {config?.has_api_key && <span className="text-green-600">（已配置）</span>}
          <input
            type="password"
            value={form.apiKey}
            onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
            placeholder={config?.has_api_key ? "留空保留现有 key" : "sk-..."}
            className="border rounded px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Model
          <input
            value={form.model}
            onChange={(e) => setForm({ ...form, model: e.target.value })}
            placeholder="gpt-4o"
            className="border rounded px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Max Context Size
          <input
            type="number"
            value={form.maxContextSize}
            onChange={(e) => setForm({ ...form, maxContextSize: parseInt(e.target.value) || 32000 })}
            className="border rounded px-2 py-1"
          />
        </label>
      </div>
      <button
        onClick={handleSave}
        disabled={saving}
        className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
      >
        {saving ? "保存中..." : saved ? "已保存 ✓" : "保存配置"}
      </button>
    </div>
  )
}
