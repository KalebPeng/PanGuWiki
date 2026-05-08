import { useTranslation } from "react-i18next"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { SettingsDraft, DraftSetter } from "../settings-types"

interface Props {
  draft: SettingsDraft
  setDraft: DraftSetter
}

const PROVIDER_OPTIONS: Array<{ value: SettingsDraft["multimodalProvider"]; label: string }> = [
  { value: "custom", label: "自定义（OpenAI 兼容）" },
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "google", label: "Google (Gemini)" },
  { value: "ollama", label: "Ollama" },
]

export function MultimodalSection({ draft, setDraft }: Props) {
  const { t } = useTranslation()

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">{t("settings.sections.multimodal.title", "图片描述")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(
            "settings.sections.multimodal.description",
            "在导入 PDF / DOCX / PPTX 时，为提取出的图片生成事实性描述。描述会写入源 markdown 的 alt 文本中，按图片内容搜索时就靠它命中。按图片哈希缓存，重复出现的 logo 或图表只会调用一次模型。",
          )}
        </p>
      </div>

      {/* Master toggle. Off by default — captioning is a non-trivial
          token spend (one VLM call per image), and silently turning
          it on for every user the first time they import a PDF
          would surprise the budget.

          Note: the toggle row deliberately uses a 2-tier border +
          a textual ON/OFF state next to the pill switch. An earlier
          version had only the small pill and several users missed
          it entirely — pills are subtle when surrounded by long
          help text. The textual ON/OFF and the matching colored
          ring make the current state unambiguous at a glance. */}
      <div
        className={`flex items-center justify-between rounded-md border-2 p-3 transition-colors ${
          draft.multimodalEnabled
            ? "border-primary/40 bg-primary/5"
            : "border-border bg-background"
        }`}
      >
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">
            {t("settings.sections.multimodal.enableLabel", "导入时生成图片描述")}
          </div>
          <div className="text-xs text-muted-foreground">
            {t(
              "settings.sections.multimodal.enableHint",
              "关闭：图片仍会被提取，但不会生成描述，搜索也无法按视觉内容命中。开启：每张新图片会触发一次视觉模型调用（按哈希缓存）。",
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setDraft("multimodalEnabled", !draft.multimodalEnabled)}
          role="switch"
          aria-checked={draft.multimodalEnabled}
          aria-label={t("settings.sections.multimodal.enableLabel", "导入时生成图片描述")}
          className="ml-3 flex shrink-0 items-center gap-2"
        >
          <span
            className={`text-xs font-semibold ${
              draft.multimodalEnabled ? "text-primary" : "text-muted-foreground"
            }`}
          >
            {draft.multimodalEnabled
              ? t("settings.sections.multimodal.stateOn", "已开启")
              : t("settings.sections.multimodal.stateOff", "已关闭")}
          </span>
          <span
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              draft.multimodalEnabled ? "bg-primary" : "bg-muted"
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                draft.multimodalEnabled ? "translate-x-4.5" : "translate-x-0.5"
              }`}
            />
          </span>
        </button>
      </div>

      {draft.multimodalEnabled && (
        <>
          {/* "Use main LLM" toggle. Lets users with a single VL-capable
              model in their main config save the trouble of typing
              everything twice. The dedicated fields below show only
              when this is OFF.

              Layout: the text column needs `min-w-0 flex-1` so a
              long help text wraps inside its column instead of
              shoving the toggle off to the right (or worse,
              forcing the row's intrinsic width past the parent).
              Without this the row visibly broke in English where
              the multi-clause hint sentence is much longer than
              the equivalent CJK text. The toggle gets `shrink-0`
              for the symmetric reason — never lose the toggle to
              the text column. */}
          <div className="flex items-center justify-between gap-3 rounded-md border p-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">
                {t("settings.sections.multimodal.useMainLabel", "使用主 LLM 生成描述")}
              </div>
              <div className="text-xs text-muted-foreground">
                {t(
                  "settings.sections.multimodal.useMainHint",
                  "复用“设置 -> LLM 提供商”里选中的模型。只有该模型支持图像输入时才建议开启，纯文本模型会返回 400。",
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setDraft("multimodalUseMainLlm", !draft.multimodalUseMainLlm)}
              role="switch"
              aria-checked={draft.multimodalUseMainLlm}
              aria-label={t(
                "settings.sections.multimodal.useMainLabel",
                "使用主 LLM 生成描述",
              )}
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                draft.multimodalUseMainLlm ? "bg-primary" : "bg-muted"
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                  draft.multimodalUseMainLlm ? "translate-x-4.5" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>

          {!draft.multimodalUseMainLlm && (
            <div className="space-y-4 rounded-md border p-3">
              <div className="text-sm font-medium">
                {t("settings.sections.multimodal.dedicatedHeading", "独立视觉端点")}
              </div>

              <div className="space-y-2">
                <Label>{t("settings.sections.multimodal.provider", "提供商")}</Label>
                <select
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={draft.multimodalProvider}
                  onChange={(e) =>
                    setDraft("multimodalProvider", e.target.value as SettingsDraft["multimodalProvider"])
                  }
                >
                  {PROVIDER_OPTIONS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>

              {draft.multimodalProvider === "ollama" && (
                <div className="space-y-2">
                  <Label>{t("settings.sections.multimodal.ollamaUrl", "Ollama 地址")}</Label>
                  <Input
                    value={draft.multimodalOllamaUrl}
                    onChange={(e) => setDraft("multimodalOllamaUrl", e.target.value)}
                    placeholder="http://localhost:11434"
                  />
                </div>
              )}

              {draft.multimodalProvider === "custom" && (
                <div className="space-y-2">
                  <Label>{t("settings.sections.multimodal.customEndpoint", "端点地址")}</Label>
                  <Input
                    value={draft.multimodalCustomEndpoint}
                    onChange={(e) => setDraft("multimodalCustomEndpoint", e.target.value)}
                    placeholder="http://localhost:1234/v1"
                  />
                  <p className="text-xs text-muted-foreground">
                    {t(
                      "settings.sections.multimodal.customEndpointHint",
                      "OpenAI 兼容的 /v1 根地址。LM Studio、llama.cpp server、vLLM、LocalAI 都可以使用。",
                    )}
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <Label>{t("settings.sections.multimodal.apiKey", "API Key")}</Label>
                <Input
                  type="password"
                  value={draft.multimodalApiKey}
                  onChange={(e) => setDraft("multimodalApiKey", e.target.value)}
                  placeholder={t(
                    "settings.sections.multimodal.apiKeyPlaceholder",
                    "本地或无需鉴权的端点可留空",
                  )}
                />
              </div>

              <div className="space-y-2">
                <Label>{t("settings.sections.multimodal.model", "模型")}</Label>
                <Input
                  value={draft.multimodalModel}
                  onChange={(e) => setDraft("multimodalModel", e.target.value)}
                  placeholder="e.g. Qwen2.5-VL-7B-Instruct, claude-3-5-sonnet-latest, gemini-2.5-flash"
                />
                <p className="text-xs text-muted-foreground">
                  {t(
                    "settings.sections.multimodal.modelHint",
                    "必须是支持视觉输入的模型。纯文本模型会在首次导入时返回 400 / image-not-supported 错误。",
                  )}
                </p>
              </div>
            </div>
          )}

          {/* Concurrency knob — practical impact: a 30-image PDF at
              concurrency=1 with a 10s/image VLM is 5 minutes of
              ingest wall time; concurrency=4 makes it ~75s. Going
              wider than ~8 is rarely a win on a single-GPU server
              that batches under the hood anyway. */}
          <div className="space-y-2 rounded-md border p-3">
            <Label>{t("settings.sections.multimodal.concurrency", "Concurrent caption requests")}</Label>
            <Input
              type="number"
              min={1}
              max={16}
              step={1}
              value={draft.multimodalConcurrency}
              onChange={(e) => {
                const n = Number(e.target.value)
                setDraft("multimodalConcurrency", Number.isFinite(n) ? n : 4)
              }}
            />
            <p className="text-xs text-muted-foreground">
              {t(
                "settings.sections.multimodal.concurrencyHint",
                "How many caption requests run in parallel. 1 = strictly sequential. 4 is a good default for most setups; raise to 8+ only on a beefy GPU or hosted endpoint.",
              )}
            </p>
          </div>

          {/* Cost guardrail panel — mostly informational for now. */}
          <div className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
            <div className="text-sm font-medium text-amber-700 dark:text-amber-400">
              {t("settings.sections.multimodal.costHeading", "Cost guardrails")}
            </div>
            <ul className="ml-4 list-disc space-y-1 text-xs text-muted-foreground">
              <li>
                {t(
                  "settings.sections.multimodal.costPoint1",
                  "Each new image triggers one vision-LLM call (~500-2000 tokens depending on model + thinking mode).",
                )}
              </li>
              <li>
                {t(
                  "settings.sections.multimodal.costPoint2",
                  "Captions are cached by SHA-256 of image bytes. Duplicate logos / shared chart templates across documents only ever incur ONE call.",
                )}
              </li>
              <li>
                {t(
                  "settings.sections.multimodal.costPoint3",
                  "Rust-side filter drops images smaller than 100×100 px and caps at 500 images per source — pathological PDFs can't blow up the bill.",
                )}
              </li>
              <li>
                {t(
                  "settings.sections.multimodal.costPoint4",
                  "Prefer a local vision model (Qwen2.5-VL via LM Studio / Ollama) for bulk ingestion; reserve hosted vision APIs for one-off high-stakes documents.",
                )}
              </li>
            </ul>
          </div>
        </>
      )}
    </div>
  )
}
