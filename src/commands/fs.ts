import type { FileNode, WikiProject } from "@/types/wiki"
import { ensureProjectId, upsertProjectInfo } from "@/lib/project-identity"
import { httpGet, httpPost, httpDelete } from "@/api/dotnet-client"

const enc = encodeURIComponent

export async function readFile(path: string): Promise<string> {
  return httpGet<string>(`/api/file/read?path=${enc(path)}`)
}

export async function writeFile(path: string, contents: string): Promise<void> {
  return httpPost<void>('/api/file/write', { path, contents })
}

export async function listDirectory(path: string): Promise<FileNode[]> {
  return httpGet<FileNode[]>(`/api/file/list?path=${enc(path)}`)
}

export async function copyFile(source: string, destination: string): Promise<void> {
  return httpPost<void>('/api/file/copy', { source, destination })
}

export async function preprocessFile(path: string): Promise<string> {
  return httpPost<string>('/api/file/preprocess', { path })
}

export async function deleteFile(path: string): Promise<void> {
  return httpDelete<void>(`/api/file?path=${enc(path)}`)
}

export async function findRelatedWikiPages(
  projectPath: string,
  sourceName: string,
): Promise<string[]> {
  return httpPost<string[]>('/api/file/find-related', { projectPath, sourceName })
}

export async function createDirectory(path: string): Promise<void> {
  return httpPost<void>('/api/file/create-directory', { path })
}

export async function fileExists(path: string): Promise<boolean> {
  return httpGet<boolean>(`/api/file/exists?path=${enc(path)}`)
}

/** Mirror of `commands::fs::FileBase64` (Rust side). */
export interface FileBase64 {
  base64: string
  mimeType: string
}

/**
 * Read any file off disk as base64 + a guessed mime type. The
 * vision-caption pipeline uses this to pick up extracted images
 * without having to read them as UTF-8 strings (PNG bytes aren't
 * valid UTF-8 — `readFile` would corrupt them).
 */
export async function readFileAsBase64(path: string): Promise<FileBase64> {
  return httpGet<FileBase64>(`/api/file/base64?path=${enc(path)}`)
}

interface RawProject {
  name: string
  path: string
}

interface RawProjectDiscoveryResponse {
  root_path: string
  projects: RawProject[]
}

export interface ProjectDiscoveryResult {
  rootPath: string
  projects: WikiProject[]
}

export async function discoverProjects(): Promise<ProjectDiscoveryResult> {
  const raw = await httpGet<RawProjectDiscoveryResponse>('/api/project/discover')
  const projects = await Promise.all(
    raw.projects.map(async (project) => {
      const id = await ensureProjectId(project.path)
      await upsertProjectInfo(id, project.path, project.name)
      return { id, name: project.name, path: project.path }
    }),
  )

  return {
    rootPath: raw.root_path,
    projects,
  }
}

export async function createProject(
  name: string,
  path: string,
): Promise<WikiProject> {
  const raw = await httpPost<RawProject>('/api/project/create', { name, path })
  const id = await ensureProjectId(raw.path)
  await upsertProjectInfo(id, raw.path, raw.name)
  return { id, name: raw.name, path: raw.path }
}

export async function openProject(path: string): Promise<WikiProject> {
  const raw = await httpPost<RawProject>('/api/project/open', { path })
  const id = await ensureProjectId(raw.path)
  await upsertProjectInfo(id, raw.path, raw.name)
  return { id, name: raw.name, path: raw.path }
}

export async function clipServerStatus(): Promise<string> {
  return httpGet<string>('/api/status/clip')
}

export async function copyDirectory(
  source: string,
  destination: string,
): Promise<string[]> {
  return httpPost<string[]>('/api/file/copy-directory', { source, destination })
}
