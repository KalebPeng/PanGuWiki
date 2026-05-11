const BASE_URL = import.meta.env.VITE_DOTNET_URL ?? 'http://localhost:5200'

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
  const res = await fetch(`${BASE_URL}${path}`)
  if (!res.ok) throw new Error(await parseError(res))
  return parseBody<T>(res)
}

export async function httpPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(await parseError(res))
  return parseBody<T>(res)
}

export async function httpDelete<T = void>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await parseError(res))
  return parseBody<T>(res)
}

export async function httpUpload<T>(path: string, formData: FormData): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, { method: 'POST', body: formData })
  if (!res.ok) throw new Error(await parseError(res))
  return parseBody<T>(res)
}
