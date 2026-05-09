/**
 * Project identity: stable UUID per project + global registry mapping
 * `UUID → current filesystem path`.
 *
 * Why: absolute paths are unstable (users move / rename project folders).
 * Queue tasks reference projects by UUID and look up the current path
 * via the registry at run time, so a moved folder doesn't orphan tasks.
 *
 * Storage:
 * - Per-project identity: `{project}/.llm-wiki/project.json`
 *     `{ "id": "<uuid>", "createdAt": <ms> }`
 * - Global registry: Tauri plugin-store `app-state.json` key `projectRegistry`
 *     `{ [id]: { id, path, name, lastOpened } }`
 */

import { readFile, writeFile } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"

const REGISTRY_KEY = "projectRegistry"


export interface ProjectIdentity {
  id: string
  createdAt: number
}

export interface ProjectRegistryEntry {
  id: string
  path: string       // latest known filesystem path (normalized forward slashes)
  name: string
  lastOpened: number
}

export type ProjectRegistry = Record<string, ProjectRegistryEntry>

export function generateProjectId(): string {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID()
  }

  // `crypto.randomUUID()` is only available in secure contexts in some
  // browsers. Keep project creation working on plain HTTP deployments.
  const bytes = new Uint8Array(16)
  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256)
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0"))
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`
}

// ── Per-project identity (reads/creates `.llm-wiki/project.json`) ─────────

function identityPath(projectPath: string): string {
  return `${normalizePath(projectPath)}/.llm-wiki/project.json`
}

/**
 * Return the project's stable UUID. Generates + writes one on first call
 * for a project that doesn't have `.llm-wiki/project.json` yet.
 */
export async function ensureProjectId(projectPath: string): Promise<string> {
  const path = identityPath(projectPath)
  try {
    const raw = await readFile(path)
    const parsed = JSON.parse(raw) as ProjectIdentity
    if (parsed?.id && typeof parsed.id === "string") {
      return parsed.id
    }
  } catch {
    // missing or corrupt — fall through to create
  }
  const identity: ProjectIdentity = {
    id: generateProjectId(),
    createdAt: Date.now(),
  }
  try {
    await writeFile(path, JSON.stringify(identity, null, 2))
  } catch (err) {
    console.warn("[project-identity] failed to write identity file:", err)
  }
  return identity.id
}

// ── Global registry (localStorage) ───────────────────────────────────────

export async function loadRegistry(): Promise<ProjectRegistry> {
  try {
    const raw = localStorage.getItem(`llmwiki:${REGISTRY_KEY}`)
    return raw ? (JSON.parse(raw) as ProjectRegistry) : {}
  } catch {
    return {}
  }
}

async function saveRegistry(registry: ProjectRegistry): Promise<void> {
  localStorage.setItem(`llmwiki:${REGISTRY_KEY}`, JSON.stringify(registry))
}

/**
 * Create or update the registry entry for this project. Call on open /
 * create / switch so the path always reflects the latest known location.
 */
export async function upsertProjectInfo(
  id: string,
  path: string,
  name: string,
): Promise<void> {
  const registry = await loadRegistry()
  registry[id] = {
    id,
    path: normalizePath(path),
    name,
    lastOpened: Date.now(),
  }
  await saveRegistry(registry)
}

/**
 * Look up the current filesystem path by UUID. Returns null if the
 * project isn't in the registry (e.g. was deleted or never opened).
 */
export async function getProjectPathById(id: string): Promise<string | null> {
  const registry = await loadRegistry()
  return registry[id]?.path ?? null
}

/**
 * Reverse lookup: given a path, find the UUID of a known project at
 * that exact location. Used by the clip watcher to translate
 * clip-server-supplied paths back to stable project ids.
 */
export async function getProjectIdByPath(path: string): Promise<string | null> {
  const normalized = normalizePath(path)
  const registry = await loadRegistry()
  for (const entry of Object.values(registry)) {
    if (entry.path === normalized) return entry.id
  }
  return null
}
