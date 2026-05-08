import { describe, it, expect, vi, beforeEach } from 'vitest'
import { httpGet, httpPost } from './dotnet-client'

describe('dotnet-client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  it('httpGet calls fetch with correct URL', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    )
    const result = await httpGet<{ ok: boolean }>('/health')
    expect(fetch).toHaveBeenCalledWith('http://localhost:5200/health')
    expect(result).toEqual({ ok: true })
  })

  it('httpPost sends JSON body', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ created: true }), { status: 200 })
    )
    await httpPost('/api/project/create', { name: 'test', path: '/tmp' })
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:5200/api/project/create',
      expect.objectContaining({ method: 'POST', body: '{"name":"test","path":"/tmp"}' })
    )
  })

  it('httpGet throws on non-OK response', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: 'not found' }), { status: 404 })
    )
    await expect(httpGet('/api/file/read?path=/x')).rejects.toThrow('not found')
  })
})
