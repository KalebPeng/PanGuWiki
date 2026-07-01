const BASE_URL = import.meta.env.VITE_DOTNET_URL ?? 'http://localhost:5200'

// 直接读 localStorage，不 import auth-store（避免循环依赖）
function getAuthHeader(): Record<string, string> {
  const token = localStorage.getItem('llmwiki:auth:token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function tryRefreshToken(): Promise<string | null> {
  const refreshToken = localStorage.getItem('llmwiki:auth:refresh_token')
  if (!refreshToken) return null
  try {
    const res = await fetch(`${BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    })
    if (!res.ok) return null
    const data = await res.json()
    const newAccess: string = data.access_token
    const newRefresh: string = data.refresh_token
    localStorage.setItem('llmwiki:auth:token', newAccess)
    localStorage.setItem('llmwiki:auth:refresh_token', newRefresh)
    return newAccess
  } catch {
    return null
  }
}

function handleUnauthorized(): void {
  localStorage.removeItem('llmwiki:auth:token')
  localStorage.removeItem('llmwiki:auth:refresh_token')
  // 仅在多租户模式下跳转登录页，避免破坏 Tauri 单机模式
  if (import.meta.env.VITE_MULTI_TENANT === 'true') {
    if (window.location.pathname !== '/login') {
      window.location.href = '/login'
    }
  }
}

async function parseError(res: Response): Promise<string> {
  try {
    const body = await res.json()
    return body?.error ?? res.statusText
  } catch {
    return res.statusText
  }
}

async function parseBody<T>(res: Response): Promise<T> {
  const text = await res.text()
  if (!text) return undefined as T
  const contentType = res.headers.get('Content-Type') ?? ''
  const trimmed = text.trimStart()
  const looksJson = trimmed.startsWith('{') || trimmed.startsWith('[')
  if (!contentType.toLowerCase().includes('application/json') && !looksJson) {
    return text as T
  }
  return JSON.parse(text) as T
}

export async function httpGet<T>(path: string): Promise<T> {
  let res = await fetch(`${BASE_URL}${path}`, { headers: { ...getAuthHeader() } })
  if (res.status === 401) {
    const newToken = await tryRefreshToken()
    if (newToken) {
      res = await fetch(`${BASE_URL}${path}`, { headers: { Authorization: `Bearer ${newToken}` } })
    }
    if (res.status === 401) {
      handleUnauthorized()
      throw new Error('Unauthorized')
    }
  }
  if (!res.ok) throw new Error(await parseError(res))
  return parseBody<T>(res)
}

export async function httpPost<T>(path: string, body?: unknown): Promise<T> {
  const bodyStr = body !== undefined ? JSON.stringify(body) : undefined
  let res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    body: bodyStr,
  })
  if (res.status === 401) {
    const newToken = await tryRefreshToken()
    if (newToken) {
      res = await fetch(`${BASE_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${newToken}` },
        body: bodyStr,
      })
    }
    if (res.status === 401) {
      handleUnauthorized()
      throw new Error('Unauthorized')
    }
  }
  if (!res.ok) throw new Error(await parseError(res))
  return parseBody<T>(res)
}

export async function httpDelete<T = void>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, { method: 'DELETE', headers: { ...getAuthHeader() } })
  if (res.status === 401) {
    handleUnauthorized()
    throw new Error('Unauthorized')
  }
  if (!res.ok) throw new Error(await parseError(res))
  return parseBody<T>(res)
}

export async function httpPut<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (res.status === 401) {
    handleUnauthorized()
    throw new Error('Unauthorized')
  }
  if (!res.ok) throw new Error(await parseError(res))
  return parseBody<T>(res)
}

export async function httpPatch<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (res.status === 401) {
    handleUnauthorized()
    throw new Error('Unauthorized')
  }
  if (!res.ok) throw new Error(await parseError(res))
  return parseBody<T>(res)
}

export interface ImageGenerationConfig {
  id: string
  enabled: boolean
  base_url: string
  has_api_key: boolean
  model: string
  default_size: string
}

export interface UpdateImageGenerationConfigRequest {
  enabled: boolean
  base_url: string
  api_key?: string | null
  model: string
  default_size: string
}

export interface GenerateImagesRequest {
  prompt: string
  model?: string | null
  size?: string | null
  n?: number | null
}

export interface GeneratedImageAsset {
  id: string
  prompt: string
  model: string
  size: string
  created_at: string
  content_url: string
  mime_type: string
  source_url?: string | null
}

export interface GeneratedImagesResponse {
  images: GeneratedImageAsset[]
}

function imageGenerationPath(deptId: string, suffix: string): string {
  return `/api/departments/${encodeURIComponent(deptId)}/image-generation${suffix}`
}

function generatedImagesPath(deptId: string, suffix = ''): string {
  return `/api/departments/${encodeURIComponent(deptId)}/images${suffix}`
}

function stripConfigSecret(config: ImageGenerationConfig & { api_key?: unknown }): ImageGenerationConfig {
  const { api_key: _apiKey, ...safeConfig } = config
  return safeConfig
}

export async function getImageGenerationConfig(deptId: string): Promise<ImageGenerationConfig> {
  const config = await httpGet<ImageGenerationConfig & { api_key?: unknown }>(
    imageGenerationPath(deptId, '/config')
  )
  return stripConfigSecret(config)
}

export async function updateImageGenerationConfig(
  deptId: string,
  request: UpdateImageGenerationConfigRequest
): Promise<ImageGenerationConfig> {
  const config = await httpPut<ImageGenerationConfig & { api_key?: unknown }>(
    imageGenerationPath(deptId, '/config'),
    request
  )
  return stripConfigSecret(config)
}

export function generateDepartmentImages(
  deptId: string,
  request: GenerateImagesRequest
): Promise<GeneratedImagesResponse> {
  return httpPost<GeneratedImagesResponse>(generatedImagesPath(deptId, '/generate'), request)
}

export function listGeneratedImageAssets(deptId: string): Promise<GeneratedImagesResponse> {
  return httpGet<GeneratedImagesResponse>(generatedImagesPath(deptId))
}

export function deleteGeneratedImageAsset(deptId: string, imageId: string): Promise<void> {
  return httpDelete<void>(generatedImagesPath(deptId, `/${encodeURIComponent(imageId)}`))
}

export function getGeneratedImageAssetContentUrl(
  deptId: string,
  imageId: string,
  token?: string
): string {
  const path = generatedImagesPath(deptId, `/${encodeURIComponent(imageId)}/content`)
  const authToken = token ?? (typeof localStorage === 'undefined' ? '' : localStorage.getItem('llmwiki:auth:token') ?? '')
  if (!authToken) return `${BASE_URL}${path}`
  return `${BASE_URL}${path}?token=${encodeURIComponent(authToken)}`
}

/** 在新标签页打开文件预览（PDF/Excel/Word → 后端渲染） */
export function openFilePreview(filePath: string): void {
  const token = localStorage.getItem('llmwiki:auth:token') ?? ''
  const url = `${BASE_URL}/api/file/preview?path=${encodeURIComponent(filePath)}&token=${encodeURIComponent(token)}`
  window.open(url, '_blank', 'noopener')
}

export async function httpUpload<T>(path: string, formData: FormData): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { ...getAuthHeader() },
    body: formData,
  })
  if (res.status === 401) {
    handleUnauthorized()
    throw new Error('Unauthorized')
  }
  if (!res.ok) throw new Error(await parseError(res))
  return parseBody<T>(res)
}
