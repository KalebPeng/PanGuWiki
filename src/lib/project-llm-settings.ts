import { readFile, writeFile } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import type { LlmConfig, ProviderConfigs } from "@/stores/wiki-store"

export interface ProjectLlmSettings {
  providerConfigs: ProviderConfigs
  activePresetId: string | null
  llmConfig: LlmConfig
}

function settingsPath(projectPath: string): string {
  return `${normalizePath(projectPath)}/.llm-wiki/settings.json`
}

export async function loadProjectLlmSettings(
  projectPath: string,
): Promise<ProjectLlmSettings | null> {
  try {
    const raw = await readFile(settingsPath(projectPath))
    const parsed = JSON.parse(raw) as ProjectLlmSettings
    if (
      !parsed
      || typeof parsed !== "object"
      || !parsed.llmConfig
      || !parsed.providerConfigs
      || !("activePresetId" in parsed)
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export async function saveProjectLlmSettings(
  projectPath: string,
  settings: ProjectLlmSettings,
): Promise<void> {
  await writeFile(settingsPath(projectPath), JSON.stringify(settings, null, 2))
}
