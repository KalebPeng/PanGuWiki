import { invoke } from "@tauri-apps/api/core"
import type { FileNode, WikiProject } from "@/types/wiki"
import { ensureProjectId, upsertProjectInfo } from "@/lib/project-identity"
import { httpGet, httpPost, httpDelete } from "@/api/dotnet-client"

const USE_DOTNET = import.meta.env.VITE_DOTNET_BACKEND === '1'
const enc = encodeURIComponent

export async function readFile(path: string): Promise<string> {
  return USE_DOTNET
    ? httpGet<string>(`/api/file/read?path=${enc(path)}`)
    : invoke<string>("read_file", { path })
}

export async function writeFile(path: string, contents: string): Promise<void> {
  return USE_DOTNET
    ? httpPost<void>('/api/file/write', { path, contents })
    : invoke<void>("write_file", { path, contents })
}

export async function listDirectory(path: string): Promise<FileNode[]> {
  return USE_DOTNET
    ? httpGet<FileNode[]>(`/api/file/list?path=${enc(path)}`)
    : invoke<FileNode[]>("list_directory", { path })
}

export async function copyFile(source: string, destination: string): Promise<void> {
  return USE_DOTNET
    ? httpPost<void>('/api/file/copy', { source, destination })
    : invoke("copy_file", { source, destination })
}

export async function preprocessFile(path: string): Promise<string> {
  return USE_DOTNET
    ? httpPost<string>('/api/file/preprocess', { path })
    : invoke<string>("preprocess_file", { path })
}

export async function deleteFile(path: string): Promise<void> {
  return USE_DOTNET
    ? httpDelete<void>(`/api/file?path=${enc(path)}`)
    : invoke("delete_file", { path })
}

export async function findRelatedWikiPages(
  projectPath: string,
  sourceName: string,
): Promise<string[]> {
  return USE_DOTNET
    ? httpPost<string[]>('/api/file/find-related', { projectPath, sourceName })
    : invoke<string[]>("find_related_wiki_pages", { projectPath, sourceName })
}

export async function createDirectory(path: string): Promise<void> {
  return USE_DOTNET
    ? httpPost<void>('/api/file/create-directory', { path })
    : invoke<void>("create_directory", { path })
}

export async function fileExists(path: string): Promise<boolean> {
  return USE_DOTNET
    ? httpGet<boolean>(`/api/file/exists?path=${enc(path)}`)
    : invoke<boolean>("file_exists", { path })
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
  return USE_DOTNET
    ? httpGet<FileBase64>(`/api/file/base64?path=${enc(path)}`)
    : invoke<FileBase64>("read_file_as_base64", { path })
}

interface RawProject {
  name: string
  path: string
}

export async function createProject(
  name: string,
  path: string,
): Promise<WikiProject> {
  const raw = USE_DOTNET
    ? await httpPost<RawProject>('/api/project/create', { name, path })
    : await invoke<RawProject>("create_project", { name, path })
  const id = await ensureProjectId(raw.path)
  await upsertProjectInfo(id, raw.path, raw.name)
  return { id, name: raw.name, path: raw.path }
}

export async function openProject(path: string): Promise<WikiProject> {
  const raw = USE_DOTNET
    ? await httpPost<RawProject>('/api/project/open', { path })
    : await invoke<RawProject>("open_project", { path })
  const id = await ensureProjectId(raw.path)
  await upsertProjectInfo(id, raw.path, raw.name)
  return { id, name: raw.name, path: raw.path }
}

export async function clipServerStatus(): Promise<string> {
  return USE_DOTNET
    ? httpGet<string>('/api/status/clip')
    : invoke<string>("clip_server_status")
}

export async function copyDirectory(
  source: string,
  destination: string,
): Promise<string[]> {
  return USE_DOTNET
    ? httpPost<string[]>('/api/file/copy-directory', { source, destination })
    : invoke<string[]>("copy_directory", { source, destination })
}
