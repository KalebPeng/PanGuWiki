import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  AlertCircle,
  Download,
  Eye,
  ImageIcon,
  Loader2,
  RefreshCw,
  Settings,
  Sparkles,
  Trash2,
} from "lucide-react"

import {
  createGeneratedImageAssetObjectUrl,
  deleteGeneratedImageAsset,
  generateDepartmentImages,
  getImageGenerationConfig,
  listGeneratedImageAssets,
  type GeneratedImageAsset,
  type GeneratedImagesResponse,
  type ImageGenerationConfig,
} from "@/api/dotnet-client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { getDashboardViewPath } from "@/pages/dashboard-navigation"
import { DashboardSidebar } from "@/pages/WikiDashboardPage"

interface Props {
  deptId: string
}

const IMAGE_SIZES = [
  "1024x1024",
  "1024x1536",
  "1536x1024",
  "9:16",
  "2:3",
  "3:4",
  "4:5",
  "1:1",
  "5:4",
  "4:3",
  "3:2",
  "16:9",
  "21:9",
  "9:21",
  "1:2",
  "2:1",
] as const
const DEFAULT_PROMPT =
  "一张适合知识库封面的简洁插画，清晰构图，柔和自然光，留出标题空间"

type ObjectUrlMap = Record<string, string>

interface ImageGenerationPageLoaders {
  loadConfig: () => Promise<ImageGenerationConfig>
  loadAssets: () => Promise<GeneratedImagesResponse>
}

interface ImageGenerationPageData {
  config: ImageGenerationConfig | null
  assets: GeneratedImageAsset[]
  configError: string | null
  assetsError: string | null
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback
}

export function clampImageCount(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(4, Math.max(1, Math.round(value)))
}

export function mergeGeneratedImageAssets(
  existing: GeneratedImageAsset[],
  incoming: GeneratedImageAsset[]
): GeneratedImageAsset[] {
  const incomingIds = new Set(incoming.map((image) => image.id))
  return [...incoming, ...existing.filter((image) => !incomingIds.has(image.id))]
}

export function revokeRemovedObjectUrls(
  current: ObjectUrlMap,
  nextIds: Set<string>,
  revoke: (url: string) => void = URL.revokeObjectURL
): ObjectUrlMap {
  const next: ObjectUrlMap = {}
  for (const [id, url] of Object.entries(current)) {
    if (nextIds.has(id)) {
      next[id] = url
    } else {
      revoke(url)
    }
  }
  return next
}

export function getImageGenerationConfigProblem(
  config: ImageGenerationConfig | null
): string | null {
  if (!config) {
    return "AI 图片生成尚未配置。请前往工作区设置完成图片生成配置后再生成。"
  }
  if (!config.enabled) {
    return "AI 图片生成未启用。请前往工作区设置开启图片生成并保存配置。"
  }
  if (!config.has_api_key) {
    return "AI 图片生成缺少 API Key。请前往工作区设置补充密钥后再生成。"
  }
  return null
}

export async function loadImageGenerationPageData({
  loadConfig,
  loadAssets,
}: ImageGenerationPageLoaders): Promise<ImageGenerationPageData> {
  const [configResult, assetsResult] = await Promise.allSettled([
    loadConfig(),
    loadAssets(),
  ])

  return {
    config: configResult.status === "fulfilled" ? configResult.value : null,
    assets: assetsResult.status === "fulfilled" ? assetsResult.value.images : [],
    configError: configResult.status === "rejected"
      ? errorMessage(configResult.reason, "加载图片生成配置失败")
      : null,
    assetsError: assetsResult.status === "rejected"
      ? errorMessage(assetsResult.reason, "加载素材库失败")
      : null,
  }
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function parseSize(size: string): { width: number; height: number } {
  const separator = size.includes(":") ? ":" : "x"
  const [width, height] = size.split(separator).map((part) => Number.parseInt(part, 10))
  return {
    width: Number.isFinite(width) ? width : 1,
    height: Number.isFinite(height) ? height : 1,
  }
}

function parseReferenceImageUrls(value: string): string[] {
  return value
    .split(/[\n,]+/)
    .map((url) => url.trim())
    .filter(Boolean)
}

function aspectRatioClass(size: string): string {
  const { width, height } = parseSize(size)
  if (height > width) return "aspect-[2/3]"
  if (width > height) return "aspect-[3/2]"
  return "aspect-square"
}

function ImageTile({
  asset,
  objectUrl,
  deleting,
  onPreview,
  onDownload,
  onDelete,
}: {
  asset: GeneratedImageAsset
  objectUrl: string | undefined
  deleting: boolean
  onPreview: () => void
  onDownload: () => void
  onDelete: () => void
}) {
  return (
    <article className="overflow-hidden rounded-[10px] border border-[#EDEDEB] bg-white shadow-[0_1px_2px_rgba(20,20,30,0.04)]">
      <button
        type="button"
        onClick={onPreview}
        disabled={!objectUrl}
        className={`group relative block w-full bg-[#F7F7F5] ${aspectRatioClass(asset.size)}`}
        aria-label="预览图片"
      >
        {objectUrl ? (
          <img
            src={objectUrl}
            alt={asset.prompt}
            className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.015]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[#8E8E94]">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}
        <span className="absolute left-2 top-2 rounded-md bg-white/90 px-2 py-1 text-[11px] font-medium text-[#5C5C66] shadow-sm">
          {asset.size}
        </span>
      </button>

      <div className="space-y-3 p-3">
        <div>
          <p className="line-clamp-2 min-h-[38px] text-[13px] leading-[1.45] text-[#1A1A2E]">
            {asset.prompt}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-[#8E8E94]">
            <span>{asset.model}</span>
            <span>·</span>
            <span>{formatDateTime(asset.created_at)}</span>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onPreview}
            disabled={!objectUrl}
            title="预览"
          >
            <Eye className="h-3.5 w-3.5" />
            预览
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onDownload}
            disabled={!objectUrl}
            title="下载"
            aria-label="下载图片"
          >
            <Download className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onDelete}
            disabled={deleting}
            title="删除"
            aria-label="删除图片"
            className="ml-auto text-[#B5384E] hover:bg-[#FDF1F3] hover:text-[#B5384E]"
          >
            {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>
    </article>
  )
}

export function ImageGenerationPage({ deptId }: Props) {
  const navigate = useNavigate()
  const [config, setConfig] = useState<ImageGenerationConfig | null>(null)
  const [configChecked, setConfigChecked] = useState(false)
  const [assets, setAssets] = useState<GeneratedImageAsset[]>([])
  const [objectUrls, setObjectUrls] = useState<ObjectUrlMap>({})
  const objectUrlsRef = useRef<ObjectUrlMap>({})
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT)
  const [size, setSize] = useState<string>("1024x1024")
  const [count, setCount] = useState(1)
  const [referenceImageUrls, setReferenceImageUrls] = useState("")
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [deletingIds, setDeletingIds] = useState<Set<string>>(() => new Set())
  const [error, setError] = useState<string | null>(null)
  const [previewAsset, setPreviewAsset] = useState<GeneratedImageAsset | null>(null)
  const mountedRef = useRef(false)
  const deptIdRef = useRef(deptId)
  const refreshRequestRef = useRef(0)
  const generateRequestRef = useRef(0)

  const configProblem = useMemo(
    () => (configChecked ? getImageGenerationConfigProblem(config) : null),
    [config, configChecked]
  )
  const isViduModel = config?.model.toLowerCase().startsWith("vidu/") ?? false
  const referenceImages = useMemo(() => parseReferenceImageUrls(referenceImageUrls), [referenceImageUrls])
  const canGenerate =
    prompt.trim().length > 0 &&
    !!config &&
    !loading &&
    !generating &&
    !configProblem

  useEffect(() => {
    objectUrlsRef.current = objectUrls
  }, [objectUrls])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      for (const url of Object.values(objectUrlsRef.current)) {
        URL.revokeObjectURL(url)
      }
      objectUrlsRef.current = {}
    }
  }, [])

  useEffect(() => {
    deptIdRef.current = deptId
    refreshRequestRef.current += 1
    generateRequestRef.current += 1
  }, [deptId])

  useEffect(() => {
    let cancelled = false

    async function loadPage() {
      setLoading(true)
      setError(null)
      setConfigChecked(false)
      try {
        const result = await loadImageGenerationPageData({
          loadConfig: () => getImageGenerationConfig(deptId),
          loadAssets: () => listGeneratedImageAssets(deptId),
        })
        if (cancelled) return
        setConfig(result.config)
        setConfigChecked(true)
        setAssets(result.assets)
        if (result.assetsError) setError(result.assetsError)
        const configuredSize = result.config
          ? IMAGE_SIZES.find((option) => option === result.config?.default_size)
          : null
        if (configuredSize) setSize(configuredSize)
      } catch (err) {
        if (!cancelled) {
          setError(errorMessage(err, "加载图片生成页面失败"))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadPage()
    return () => {
      cancelled = true
    }
  }, [deptId])

  useEffect(() => {
    let cancelled = false
    const ids = new Set(assets.map((asset) => asset.id))
    const knownUrls = objectUrlsRef.current

    setObjectUrls((current) => revokeRemovedObjectUrls(current, ids))

    for (const asset of assets) {
      if (knownUrls[asset.id]) continue
      createGeneratedImageAssetObjectUrl(deptId, asset.id)
        .then((url) => {
          if (cancelled) {
            URL.revokeObjectURL(url)
            return
          }
          setObjectUrls((current) => {
            if (!ids.has(asset.id)) {
              URL.revokeObjectURL(url)
              return current
            }
            if (current[asset.id]) {
              URL.revokeObjectURL(url)
              return current
            }
            return { ...current, [asset.id]: url }
          })
        })
        .catch(() => {})
    }

    return () => {
      cancelled = true
    }
  }, [assets, deptId])

  async function refreshAssets() {
    const requestId = ++refreshRequestRef.current
    const requestDeptId = deptId
    setRefreshing(true)
    setError(null)
    try {
      const response = await listGeneratedImageAssets(requestDeptId)
      if (!mountedRef.current || deptIdRef.current !== requestDeptId || refreshRequestRef.current !== requestId) return
      setAssets(response.images)
    } catch (err) {
      if (!mountedRef.current || deptIdRef.current !== requestDeptId || refreshRequestRef.current !== requestId) return
      setError(err instanceof Error ? err.message : "刷新素材库失败")
    } finally {
      if (!mountedRef.current || deptIdRef.current !== requestDeptId || refreshRequestRef.current !== requestId) return
      setRefreshing(false)
    }
  }

  async function handleGenerate(event: React.FormEvent) {
    event.preventDefault()
    const trimmedPrompt = prompt.trim()
    if (!trimmedPrompt || configProblem) return

    const requestId = ++generateRequestRef.current
    const requestDeptId = deptId
    setGenerating(true)
    setError(null)
    try {
      const response = await generateDepartmentImages(requestDeptId, {
        prompt: trimmedPrompt,
        size,
        n: clampImageCount(count),
        images: referenceImages,
      })
      if (!mountedRef.current || deptIdRef.current !== requestDeptId || generateRequestRef.current !== requestId) return
      setAssets((current) => mergeGeneratedImageAssets(current, response.images))
    } catch (err) {
      if (!mountedRef.current || deptIdRef.current !== requestDeptId || generateRequestRef.current !== requestId) return
      setError(err instanceof Error ? err.message : "生成图片失败")
    } finally {
      if (!mountedRef.current || deptIdRef.current !== requestDeptId || generateRequestRef.current !== requestId) return
      setGenerating(false)
    }
  }

  async function handleDelete(asset: GeneratedImageAsset) {
    if (!window.confirm("确认从素材库删除这张图片吗？")) return

    const requestDeptId = deptId
    setDeletingIds((current) => new Set(current).add(asset.id))
    setError(null)
    try {
      await deleteGeneratedImageAsset(requestDeptId, asset.id)
      if (!mountedRef.current || deptIdRef.current !== requestDeptId) return
      setPreviewAsset((current) => (current?.id === asset.id ? null : current))
      setAssets((current) => current.filter((item) => item.id !== asset.id))
    } catch (err) {
      if (!mountedRef.current || deptIdRef.current !== requestDeptId) return
      setError(err instanceof Error ? err.message : "删除图片失败")
    } finally {
      if (!mountedRef.current || deptIdRef.current !== requestDeptId) return
      setDeletingIds((current) => {
        const next = new Set(current)
        next.delete(asset.id)
        return next
      })
    }
  }

  function handleDownload(asset: GeneratedImageAsset) {
    const url = objectUrls[asset.id]
    if (!url) return
    const extension = asset.mime_type.includes("jpeg") ? "jpg" : "png"
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `generated-image-${asset.id}.${extension}`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  }

  return (
    <div
      className="flex min-h-screen"
      style={{ fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro SC','PingFang SC','Helvetica Neue','Microsoft YaHei',system-ui,sans-serif" }}
    >
      <DashboardSidebar
        deptId={deptId}
        activeView="images"
        onChangeView={(view) => {
          if (view === "home" || view === "settings" || view === "admin") {
            navigate(getDashboardViewPath(deptId, view))
          }
        }}
      />

      <main className="min-w-0 flex-1 bg-white">
        <div className="mx-auto max-w-[1120px] px-5 pb-16 pt-8 sm:px-8 lg:px-12 lg:pt-14">
          <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="m-0 mb-1.5 text-[26px] font-semibold leading-tight tracking-tight text-[#1A1A2E] sm:text-[28px]">
                AI 图片生成
              </h1>
              <p className="m-0 max-w-[680px] text-[14.5px] leading-relaxed text-[#5C5C66]">
                输入提示词生成图片，并保存到当前账号的素材库。这里的图片独立于 Wiki 文件。
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={refreshAssets}
              disabled={refreshing || loading}
              className="self-start"
            >
              {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              刷新素材库
            </Button>
          </div>

          {error && (
            <div className="mb-5 flex gap-2 rounded-[10px] border border-[#F0C7CE] bg-[#FDF1F3] px-4 py-3 text-[13px] leading-relaxed text-[#9B2D45]">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {configProblem && (
            <div className="mb-5 flex flex-col gap-3 rounded-[10px] border border-[#E7D7A8] bg-[#FFF9E8] px-4 py-3 text-[13px] leading-relaxed text-[#7A5A12] sm:flex-row sm:items-center sm:justify-between">
              <div className="flex gap-2">
                <Settings className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{configProblem}</span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => navigate(getDashboardViewPath(deptId, "settings"))}
                className="self-start border-[#E7D7A8] bg-white/60 text-[#674B0D] hover:bg-white"
              >
                去工作区设置
              </Button>
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
            <form
              onSubmit={handleGenerate}
              className="h-fit rounded-[10px] border border-[#EDEDEB] bg-[#FAFAF9] p-4 shadow-[0_1px_2px_rgba(20,20,30,0.04)]"
            >
              <div className="mb-4 flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-[#EDEDEB] bg-white text-[#1A1A2E]">
                  <Sparkles className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-[15px] font-semibold text-[#1A1A2E]">生成设置</h2>
                  <p className="text-[12px] text-[#8E8E94]">同步生成，完成后自动进入素材库</p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="image-prompt" className="text-[#1A1A2E]">提示词</Label>
                  <textarea
                    id="image-prompt"
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    placeholder="描述画面、风格、主体、用途..."
                    rows={7}
                    className="min-h-[150px] w-full resize-y rounded-lg border border-[#E2E2DF] bg-white px-3 py-2.5 text-[13.5px] leading-relaxed text-[#1A1A2E] outline-none transition-colors placeholder:text-[#B5B5BB] focus:border-[#B8B8B2] focus:ring-3 focus:ring-[#EDEDEB]"
                  />
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="image-size" className="text-[#1A1A2E]">尺寸</Label>
                    <select
                      id="image-size"
                      value={size}
                      onChange={(event) => setSize(event.target.value)}
                      className="h-9 w-full rounded-lg border border-[#E2E2DF] bg-white px-3 text-[13px] text-[#1A1A2E] outline-none focus:border-[#B8B8B2] focus:ring-3 focus:ring-[#EDEDEB]"
                    >
                      {IMAGE_SIZES.map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="image-count" className="text-[#1A1A2E]">数量</Label>
                    <input
                      id="image-count"
                      type="number"
                      min={1}
                      max={4}
                      value={count}
                      onChange={(event) => setCount(clampImageCount(event.target.valueAsNumber))}
                      className="h-9 w-full rounded-lg border border-[#E2E2DF] bg-white px-3 text-[13px] text-[#1A1A2E] outline-none focus:border-[#B8B8B2] focus:ring-3 focus:ring-[#EDEDEB]"
                    />
                  </div>
                </div>

                {isViduModel && (
                  <div className="space-y-2">
                    <Label htmlFor="reference-images" className="text-[#1A1A2E]">参考图 URL</Label>
                    <textarea
                      id="reference-images"
                      value={referenceImageUrls}
                      onChange={(event) => setReferenceImageUrls(event.target.value)}
                      placeholder="https://example.com/ref.jpg"
                      rows={3}
                      className="min-h-[76px] w-full resize-y rounded-lg border border-[#E2E2DF] bg-white px-3 py-2.5 text-[13.5px] leading-relaxed text-[#1A1A2E] outline-none transition-colors placeholder:text-[#B5B5BB] focus:border-[#B8B8B2] focus:ring-3 focus:ring-[#EDEDEB]"
                    />
                    <p className="text-[12px] leading-relaxed text-[#8E8E94]">
                      留空为文生图；填写图片地址为图生图，多张可换行或用逗号分隔。
                    </p>
                  </div>
                )}

                <Button
                  type="submit"
                  size="lg"
                  disabled={!canGenerate}
                  className="h-10 w-full bg-[#1A1A2E] text-white hover:bg-[#29293B]"
                >
                  {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
                  {generating ? "生成中..." : "生成图片"}
                </Button>
              </div>
            </form>

            <section className="min-w-0">
              <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <div className="text-[12px] font-medium uppercase tracking-[0.08em] text-[#8E8E94]">
                    素材库
                  </div>
                  <h2 className="mt-1 text-[18px] font-semibold tracking-tight text-[#1A1A2E]">
                    最近生成
                  </h2>
                </div>
                <div className="text-[12.5px] text-[#8E8E94]">
                  {assets.length} 张图片
                </div>
              </div>

              {loading ? (
                <div className="flex min-h-[320px] items-center justify-center rounded-[10px] border border-[#EDEDEB] bg-white text-[13px] text-[#8E8E94]">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  加载素材库...
                </div>
              ) : assets.length === 0 ? (
                <div className="flex min-h-[320px] flex-col items-center justify-center rounded-[10px] border border-dashed border-[#DADAD6] bg-[#FAFAF9] px-6 text-center">
                  <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-[10px] border border-[#EDEDEB] bg-white text-[#8E8E94]">
                    <ImageIcon className="h-5 w-5" />
                  </div>
                  <div className="text-[14px] font-medium text-[#1A1A2E]">素材库暂无图片</div>
                  <p className="mt-1 max-w-[320px] text-[13px] leading-relaxed text-[#8E8E94]">
                    生成后的图片会保存在当前账号下，方便后续预览、下载或删除。
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {assets.map((asset) => (
                    <ImageTile
                      key={asset.id}
                      asset={asset}
                      objectUrl={objectUrls[asset.id]}
                      deleting={deletingIds.has(asset.id)}
                      onPreview={() => setPreviewAsset(asset)}
                      onDownload={() => handleDownload(asset)}
                      onDelete={() => handleDelete(asset)}
                    />
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </main>

      <Dialog open={!!previewAsset} onOpenChange={(open) => !open && setPreviewAsset(null)}>
        <DialogContent className="max-w-[min(920px,calc(100%-2rem))]">
          <DialogHeader>
            <DialogTitle>图片预览</DialogTitle>
            <DialogDescription>
              {previewAsset?.size} · {previewAsset ? formatDateTime(previewAsset.created_at) : ""}
            </DialogDescription>
          </DialogHeader>
          {previewAsset && (
            <div className="space-y-3">
              <div className="max-h-[70vh] overflow-hidden rounded-lg border border-[#EDEDEB] bg-[#FAFAF9]">
                {objectUrls[previewAsset.id] ? (
                  <img
                    src={objectUrls[previewAsset.id]}
                    alt={previewAsset.prompt}
                    className="mx-auto max-h-[70vh] w-auto object-contain"
                  />
                ) : (
                  <div className="flex h-[320px] items-center justify-center text-[#8E8E94]">
                    <Loader2 className="h-5 w-5 animate-spin" />
                  </div>
                )}
              </div>
              <p className="text-[13px] leading-relaxed text-[#5C5C66]">{previewAsset.prompt}</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
