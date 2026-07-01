import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  deleteGeneratedImageAsset,
  generateDepartmentImages,
  getGeneratedImageAssetContentUrl,
  getImageGenerationConfig,
  httpGet,
  httpPost,
  listGeneratedImageAssets,
  updateImageGenerationConfig,
} from './dotnet-client'

const BASE_URL = import.meta.env.VITE_DOTNET_URL ?? 'http://localhost:5200'

describe('dotnet-client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    })
  })

  it('httpGet calls fetch with correct URL', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    )
    const result = await httpGet<{ ok: boolean }>('/health')
    expect(fetch).toHaveBeenCalledWith(`${BASE_URL}/health`, { headers: {} })
    expect(result).toEqual({ ok: true })
  })

  it('httpPost sends JSON body', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ created: true }), { status: 200 })
    )
    await httpPost('/api/project/create', { name: 'test', path: '/tmp' })
    expect(fetch).toHaveBeenCalledWith(
      `${BASE_URL}/api/project/create`,
      expect.objectContaining({ method: 'POST', body: '{"name":"test","path":"/tmp"}' })
    )
  })

  it('httpGet throws on non-OK response', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: 'not found' }), { status: 404 })
    )
    await expect(httpGet('/api/file/read?path=/x')).rejects.toThrow('not found')
  })

  it('httpGet returns plain text responses without JSON parsing', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('---\ntitle: Wiki Overview\n---\n', {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    )

    const result = await httpGet<string>('/api/file/read?path=/wiki/overview.md')

    expect(result).toBe('---\ntitle: Wiki Overview\n---\n')
  })

  it('gets image generation config without exposing api_key', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'config-1',
          enabled: true,
          base_url: 'https://relay.example.com',
          has_api_key: true,
          api_key: 'sk-secret',
          model: 'gpt-image-1',
          default_size: '1024x1024',
        }),
        { status: 200 }
      )
    )

    const result = await getImageGenerationConfig('dept-1')

    expect(fetch).toHaveBeenCalledWith(
      `${BASE_URL}/api/departments/dept-1/image-generation/config`,
      expect.anything()
    )
    expect(result).toEqual({
      id: 'config-1',
      enabled: true,
      base_url: 'https://relay.example.com',
      has_api_key: true,
      model: 'gpt-image-1',
      default_size: '1024x1024',
    })
    expect('api_key' in result).toBe(false)
  })

  it('updates image generation config with the backend body shape', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'config-1',
          enabled: true,
          base_url: 'https://relay.example.com',
          has_api_key: true,
          model: 'gpt-image-1',
          default_size: '1536x1024',
        }),
        { status: 200 }
      )
    )

    await updateImageGenerationConfig('dept-1', {
      enabled: true,
      base_url: 'https://relay.example.com',
      api_key: 'sk-secret',
      model: 'gpt-image-1',
      default_size: '1536x1024',
    })

    expect(fetch).toHaveBeenCalledWith(
      `${BASE_URL}/api/departments/dept-1/image-generation/config`,
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          enabled: true,
          base_url: 'https://relay.example.com',
          api_key: 'sk-secret',
          model: 'gpt-image-1',
          default_size: '1536x1024',
        }),
      })
    )
  })

  it('generates, lists, deletes, and builds content URLs for image assets', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            images: [
              {
                id: 'image-1',
                prompt: 'A quiet product photo',
                model: 'gpt-image-1',
                size: '1024x1024',
                created_at: '2026-06-30T12:00:00Z',
                content_url: '/api/departments/dept-1/image-generation/assets/image-1/content',
                mime_type: 'image/png',
                source_url: null,
              },
            ],
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ images: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    const generated = await generateDepartmentImages('dept-1', {
      prompt: 'A quiet product photo',
      model: 'gpt-image-1',
      size: '1024x1024',
      n: 1,
    })
    const listed = await listGeneratedImageAssets('dept-1')
    await deleteGeneratedImageAsset('dept-1', 'image-1')
    const contentUrl = getGeneratedImageAssetContentUrl('dept-1', 'image-1', 'token 1')

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      `${BASE_URL}/api/departments/dept-1/image-generation/generate`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          prompt: 'A quiet product photo',
          model: 'gpt-image-1',
          size: '1024x1024',
          n: 1,
        }),
      })
    )
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      `${BASE_URL}/api/departments/dept-1/image-generation/assets`,
      expect.anything()
    )
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      `${BASE_URL}/api/departments/dept-1/image-generation/assets/image-1`,
      expect.objectContaining({ method: 'DELETE' })
    )
    expect(generated.images[0].content_url).toBe('/api/departments/dept-1/image-generation/assets/image-1/content')
    expect(listed.images).toEqual([])
    expect(contentUrl).toBe(
      `${BASE_URL}/api/departments/dept-1/image-generation/assets/image-1/content?token=token%201`
    )
  })
})
