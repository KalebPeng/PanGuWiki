import { createWikiService, type WikiService } from "./wiki.js"
import type { WikiPage, WikiSearchResult } from "./wiki.js"

export type WikiProvider = WikiService

export interface LocalProviderConfig {
  mode: "local"
  projectPath?: string
}

export interface CloudProviderConfig {
  mode: "cloud"
  baseUrl?: string
  projectId?: string
  apiKey?: string
}

export type WikiProviderConfig = LocalProviderConfig | CloudProviderConfig

export async function createWikiProvider(config: WikiProviderConfig): Promise<WikiProvider> {
  if (config.mode === "local") {
    if (!config.projectPath) {
      throw new Error("local mode requires projectPath")
    }
    return createWikiService(config.projectPath)
  }

  return createCloudWikiProvider(config)
}

function createCloudWikiProvider(config: CloudProviderConfig): WikiProvider {
  const baseUrl = requireSetting(config.baseUrl, "baseUrl").replace(/\/+$/, "")
  const projectId = requireSetting(config.projectId, "projectId")
  const apiKey = requireSetting(config.apiKey ?? process.env.LLM_WIKI_API_KEY, "apiKey or LLM_WIKI_API_KEY")

  const projectBase = `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/wiki`

  return {
    listPages: async () => {
      const data = await requestJson<{ pages?: CloudPage[] } | CloudPage[]>(
        `${projectBase}/pages`,
        apiKey,
      )
      const pages = Array.isArray(data) ? data : data.pages ?? []
      return pages.map((page) => toWikiPage(page, projectId))
    },

    search: async (query, limit = 10) => {
      if (!query.trim()) throw new Error("search_wiki query cannot be empty")
      const data = await requestJson<{ results?: WikiSearchResult[] } | WikiSearchResult[]>(
        `${projectBase}/search`,
        apiKey,
        {
          method: "POST",
          body: JSON.stringify({ query, limit }),
        },
      )
      return Array.isArray(data) ? data : data.results ?? []
    },

    readPage: async (pathOrTitle) => {
      if (!pathOrTitle.trim()) throw new Error("read_wiki_page path_or_title cannot be empty")
      const url = new URL(`${projectBase}/pages/read`)
      url.searchParams.set("path_or_title", pathOrTitle)
      const page = await requestJson<CloudPage>(url.toString(), apiKey)
      return toWikiPage(page, projectId)
    },

    getOverview: async () => {
      const data = await requestJson<{ content?: string } | string>(`${projectBase}/overview`, apiKey)
      return typeof data === "string" ? data : data.content ?? ""
    },
  }
}

interface CloudPage {
  title: string
  relativePath: string
  absolutePath?: string
  content?: string
}

function toWikiPage(page: CloudPage, projectId: string): WikiPage {
  return {
    title: page.title,
    relativePath: page.relativePath,
    absolutePath: page.absolutePath ?? `cloud://${projectId}/${page.relativePath}`,
    content: page.content ?? "",
  }
}

async function requestJson<T>(
  url: string,
  apiKey: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    ...(init.headers ?? {}),
  }

  const response = await fetch(url, { ...init, headers })
  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new Error(`LLM Wiki Cloud API ${response.status} ${response.statusText}${body ? `: ${body}` : ""}`)
  }
  return await response.json() as T
}

function requireSetting(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new Error(`cloud mode requires ${name}`)
  return value
}
