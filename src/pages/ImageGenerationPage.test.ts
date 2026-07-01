import { describe, expect, it, vi } from "vitest"

import {
  clampImageCount,
  getImageGenerationConfigProblem,
  mergeGeneratedImageAssets,
  revokeRemovedObjectUrls,
} from "./ImageGenerationPage"

import type { GeneratedImageAsset, ImageGenerationConfig } from "@/api/dotnet-client"

function asset(id: string, createdAt = "2026-06-30T12:00:00Z"): GeneratedImageAsset {
  return {
    id,
    prompt: `prompt ${id}`,
    model: "gpt-image-1",
    size: "1024x1024",
    created_at: createdAt,
    content_url: `/content/${id}`,
    mime_type: "image/png",
  }
}

function config(overrides: Partial<ImageGenerationConfig>): ImageGenerationConfig {
  return {
    id: "cfg",
    enabled: true,
    base_url: "https://api.openai.com/v1",
    has_api_key: true,
    model: "gpt-image-1",
    default_size: "1024x1024",
    ...overrides,
  }
}

describe("ImageGenerationPage helpers", () => {
  it("keeps generated images at the front without duplicating existing assets", () => {
    expect(mergeGeneratedImageAssets([asset("old"), asset("same")], [asset("new"), asset("same")])).toEqual([
      asset("new"),
      asset("same"),
      asset("old"),
    ])
  })

  it("revokes object URLs for assets no longer present", () => {
    const revoke = vi.fn()

    const remaining = revokeRemovedObjectUrls(
      {
        keep: "blob:keep",
        delete: "blob:delete",
      },
      new Set(["keep"]),
      revoke
    )

    expect(remaining).toEqual({ keep: "blob:keep" })
    expect(revoke).toHaveBeenCalledWith("blob:delete")
  })

  it("clamps requested image count to the backend-supported 1..4 range", () => {
    expect(clampImageCount(0)).toBe(1)
    expect(clampImageCount(3)).toBe(3)
    expect(clampImageCount(9)).toBe(4)
  })

  it("reports disabled and missing-key config states with settings guidance", () => {
    expect(getImageGenerationConfigProblem(config({ enabled: false }))).toContain("工作区设置")
    expect(getImageGenerationConfigProblem(config({ has_api_key: false }))).toContain("API Key")
    expect(getImageGenerationConfigProblem(config({}))).toBeNull()
  })
})
