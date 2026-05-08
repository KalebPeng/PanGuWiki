const BASE_URL = import.meta.env.VITE_DOTNET_URL ?? 'http://localhost:5200'

async function parseError(res: Response): Promise<string> {
  try {
    const body = await res.json()
    return body?.error ?? res.statusText
  } catch {
    return res.statusText
  }
}

export async function httpGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`)
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function httpPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function httpDelete<T = void>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await parseError(res))
  if (res.status === 204) return undefined as T
  return res.json()
}
