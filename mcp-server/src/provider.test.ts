import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createWikiProvider } from "./provider.js"

let root: string

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "llm-wiki-provider-"))
  await mkdir(path.join(root, "wiki"), { recursive: true })
  await writeFile(path.join(root, "wiki", "overview.md"), "# 云端预留测试\n\n本地模式可读取。", "utf-8")
})

afterEach(async () => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  await import("node:fs/promises").then((fs) => fs.rm(root, { recursive: true, force: true }))
})

describe("createWikiProvider", () => {
  it("creates a local provider from projectPath", async () => {
    const provider = await createWikiProvider({ mode: "local", projectPath: root })

    await expect(provider.getOverview()).resolves.toContain("本地模式可读取")
  })

  it("requires projectPath in local mode", async () => {
    await expect(createWikiProvider({ mode: "local" })).rejects.toThrow(/projectPath/i)
  })

  it("creates a cloud provider that calls the hosted wiki API", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url)
      if (href.endsWith("/api/projects/proj_123/wiki/search")) {
        expect(init?.method).toBe("POST")
        expect(init?.headers).toMatchObject({ Authorization: "Bearer secret" })
        expect(JSON.parse(String(init?.body))).toEqual({ query: "假期", limit: 3 })
        return jsonResponse([
          {
            title: "盘古网络假期政策",
            relativePath: "wiki/concepts/盘古网络假期政策.md",
            snippet: "年假、婚假、产假",
            score: 0.9,
          },
        ])
      }

      if (href.endsWith("/api/projects/proj_123/wiki/pages")) {
        return jsonResponse({
          pages: [
            {
              title: "盘古网络假期政策",
              relativePath: "wiki/concepts/盘古网络假期政策.md",
            },
          ],
        })
      }

      if (href.includes("/api/projects/proj_123/wiki/pages/read?")) {
        return jsonResponse({
          title: "盘古网络假期政策",
          relativePath: "wiki/concepts/盘古网络假期政策.md",
          content: "# 盘古网络假期政策\n\n假期政策正文",
        })
      }

      if (href.endsWith("/api/projects/proj_123/wiki/overview")) {
        return jsonResponse({ content: "# 概览\n\n云端知识库" })
      }

      return new Response("not found", { status: 404 })
    })
    vi.stubGlobal("fetch", fetchMock)

    const provider = await createWikiProvider({
      mode: "cloud",
      baseUrl: "https://wiki.example.com/",
      projectId: "proj_123",
      apiKey: "secret",
    })

    await expect(provider.search("假期", 3)).resolves.toMatchObject([
      { title: "盘古网络假期政策", score: 0.9 },
    ])
    await expect(provider.listPages()).resolves.toMatchObject([
      { title: "盘古网络假期政策" },
    ])
    await expect(provider.readPage("盘古网络假期政策")).resolves.toMatchObject({
      content: "# 盘古网络假期政策\n\n假期政策正文",
    })
    await expect(provider.getOverview()).resolves.toBe("# 概览\n\n云端知识库")
  })

  it("reads the cloud API key from LLM_WIKI_API_KEY", async () => {
    vi.stubEnv("LLM_WIKI_API_KEY", "env-secret")
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ Authorization: "Bearer env-secret" })
      return jsonResponse({ content: "ok" })
    })
    vi.stubGlobal("fetch", fetchMock)

    const provider = await createWikiProvider({
      mode: "cloud",
      baseUrl: "https://wiki.example.com",
      projectId: "proj_123",
    })

    await expect(provider.getOverview()).resolves.toBe("ok")
  })

  it("requires cloud connection settings", async () => {
    await expect(createWikiProvider({ mode: "cloud" })).rejects.toThrow(/baseUrl/i)
    await expect(
      createWikiProvider({ mode: "cloud", baseUrl: "https://wiki.example.com" }),
    ).rejects.toThrow(/projectId/i)
    await expect(
      createWikiProvider({
        mode: "cloud",
        baseUrl: "https://wiki.example.com",
        projectId: "proj_123",
      }),
    ).rejects.toThrow(/apiKey/i)
  })
})

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}
