import { readdir, readFile, stat } from "node:fs/promises"
import path from "node:path"

export interface WikiPage {
  title: string
  relativePath: string
  absolutePath: string
  content: string
}

export interface WikiSearchResult {
  title: string
  relativePath: string
  snippet: string
  score: number
}

export interface WikiService {
  listPages(): Promise<WikiPage[]>
  search(query: string, limit?: number): Promise<WikiSearchResult[]>
  readPage(pathOrTitle: string): Promise<WikiPage>
  getOverview(): Promise<string>
}

const DEFAULT_LIMIT = 10
const SNIPPET_CONTEXT = 80

export async function createWikiService(projectPath: string): Promise<WikiService> {
  const projectRoot = path.resolve(projectPath)
  const wikiRoot = path.join(projectRoot, "wiki")
  const wikiStat = await stat(wikiRoot).catch(() => null)
  if (!wikiStat?.isDirectory()) {
    throw new Error(`Project path must contain a wiki directory: ${projectRoot}`)
  }

  return {
    listPages: () => listPages(projectRoot, wikiRoot),
    search: (query, limit = DEFAULT_LIMIT) => search(projectRoot, wikiRoot, query, limit),
    readPage: (pathOrTitle) => readPage(projectRoot, wikiRoot, pathOrTitle),
    getOverview: () => getOverview(projectRoot),
  }
}

async function listPages(projectRoot: string, wikiRoot: string): Promise<WikiPage[]> {
  const files = await walkMarkdown(wikiRoot)
  const pages = await Promise.all(files.map((file) => loadPage(projectRoot, file)))
  return pages.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}

async function walkMarkdown(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const out: string[] = []
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...await walkMarkdown(fullPath))
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      out.push(fullPath)
    }
  }
  return out
}

async function loadPage(projectRoot: string, absolutePath: string): Promise<WikiPage> {
  assertInside(projectRoot, absolutePath)
  const content = await readFile(absolutePath, "utf-8")
  return {
    title: extractTitle(content, path.basename(absolutePath)),
    relativePath: toProjectRelative(projectRoot, absolutePath),
    absolutePath,
    content,
  }
}

async function search(
  projectRoot: string,
  wikiRoot: string,
  query: string,
  limit: number,
): Promise<WikiSearchResult[]> {
  const trimmed = query.trim()
  if (!trimmed) throw new Error("search_wiki query cannot be empty")

  const pages = await listPages(projectRoot, wikiRoot)
  const tokens = tokenize(trimmed)
  const queryLower = trimmed.toLowerCase()

  const results = pages
    .map((page) => scorePage(page, tokens, queryLower, trimmed))
    .filter((result): result is WikiSearchResult => result !== null)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return a.relativePath.localeCompare(b.relativePath)
    })

  return results.slice(0, Math.max(1, limit))
}

function scorePage(
  page: WikiPage,
  tokens: string[],
  queryLower: string,
  originalQuery: string,
): WikiSearchResult | null {
  const titleLower = page.title.toLowerCase()
  const pathLower = page.relativePath.toLowerCase()
  const contentLower = page.content.toLowerCase()
  let score = 0

  if (titleLower === queryLower) score += 200
  if (titleLower.includes(queryLower)) score += 80
  if (pathLower.includes(queryLower)) score += 50

  for (const token of tokens) {
    if (titleLower.includes(token)) score += 20
    if (pathLower.includes(token)) score += 10
    if (contentLower.includes(token)) score += 2
  }

  if (contentLower.includes(queryLower)) score += 25
  if (score === 0) return null

  return {
    title: page.title,
    relativePath: page.relativePath,
    snippet: buildSnippet(page.content, originalQuery, tokens),
    score,
  }
}

async function readPage(
  projectRoot: string,
  wikiRoot: string,
  pathOrTitle: string,
): Promise<WikiPage> {
  const input = pathOrTitle.trim()
  if (!input) throw new Error("read_wiki_page path_or_title cannot be empty")

  const pathCandidate = resolvePathCandidate(projectRoot, input)
  if (pathCandidate) {
    assertInside(projectRoot, pathCandidate)
    if (!isInside(wikiRoot, pathCandidate)) {
      throw new Error(`Path is outside wiki directory: ${input}`)
    }
    return loadPage(projectRoot, pathCandidate)
  }

  const pages = await listPages(projectRoot, wikiRoot)
  const inputLower = input.toLowerCase()
  const matched = pages.find((page) => page.title.toLowerCase() === inputLower)
    ?? pages.find((page) => path.basename(page.relativePath).toLowerCase() === inputLower)
    ?? pages.find((page) => page.relativePath.toLowerCase() === normalizeSlashes(inputLower))

  if (!matched) throw new Error(`Wiki page not found: ${input}`)
  return matched
}

function resolvePathCandidate(projectRoot: string, input: string): string | null {
  const looksPathLike =
    path.isAbsolute(input) ||
    input.includes("/") ||
    input.includes("\\")

  if (!looksPathLike) return null
  if (path.isAbsolute(input)) return path.resolve(input)
  return path.resolve(projectRoot, input)
}

async function getOverview(projectRoot: string): Promise<string> {
  const candidates = [
    "purpose.md",
    "wiki/overview.md",
    "wiki/index.md",
  ]
  const sections: string[] = []

  for (const relativePath of candidates) {
    const absolutePath = path.join(projectRoot, relativePath)
    if (!isInside(projectRoot, absolutePath)) continue
    try {
      const content = await readFile(absolutePath, "utf-8")
      sections.push(`# ${relativePath}\n\n${content.trim()}`)
    } catch {
      // Optional overview files may not exist.
    }
  }

  return sections.join("\n\n---\n\n")
}

function extractTitle(content: string, fileName: string): string {
  const frontmatter = content.match(/^---\r?\n[\s\S]*?\r?\n---/)
  if (frontmatter) {
    const title = frontmatter[0].match(/^title:\s*["']?(.+?)["']?\s*$/m)
    if (title?.[1]) return title[1].trim()
  }

  const heading = content.match(/^#\s+(.+)$/m)
  if (heading?.[1]) return heading[1].trim()

  return fileName.replace(/\.md$/i, "").replace(/-/g, " ")
}

function tokenize(query: string): string[] {
  const raw = query
    .toLowerCase()
    .split(/[\s,，。！？、；：""''（）()\-_/\\·~～…]+/)
    .filter((token) => token.length > 0)

  const tokens = new Set<string>()
  for (const token of raw) {
    tokens.add(token)
    if (/[\u4e00-\u9fff]/.test(token)) {
      const chars = [...token]
      for (const char of chars) tokens.add(char)
      for (let i = 0; i < chars.length - 1; i++) {
        tokens.add(chars[i] + chars[i + 1])
      }
    }
  }

  return [...tokens]
}

function buildSnippet(content: string, query: string, tokens: string[]): string {
  const contentLower = content.toLowerCase()
  const probes = [query.toLowerCase(), ...tokens]
  let idx = -1
  let needle = ""
  for (const probe of probes) {
    idx = contentLower.indexOf(probe)
    if (idx >= 0) {
      needle = probe
      break
    }
  }
  if (idx < 0) return content.slice(0, SNIPPET_CONTEXT * 2).replace(/\s+/g, " ").trim()

  const start = Math.max(0, idx - SNIPPET_CONTEXT)
  const end = Math.min(content.length, idx + needle.length + SNIPPET_CONTEXT)
  const prefix = start > 0 ? "..." : ""
  const suffix = end < content.length ? "..." : ""
  return `${prefix}${content.slice(start, end).replace(/\s+/g, " ").trim()}${suffix}`
}

function assertInside(root: string, candidate: string): void {
  if (!isInside(root, candidate)) {
    throw new Error(`Path is outside configured project: ${candidate}`)
  }
}

function isInside(root: string, candidate: string): boolean {
  const resolvedRoot = path.resolve(root)
  const resolvedCandidate = path.resolve(candidate)
  const relative = path.relative(resolvedRoot, resolvedCandidate)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

function toProjectRelative(projectRoot: string, absolutePath: string): string {
  return normalizeSlashes(path.relative(projectRoot, absolutePath))
}

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, "/")
}
