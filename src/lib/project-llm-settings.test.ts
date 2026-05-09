import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/commands/fs", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}))

import { readFile, writeFile } from "@/commands/fs"
import {
  loadProjectLlmSettings,
  saveProjectLlmSettings,
} from "./project-llm-settings"

const mockReadFile = vi.mocked(readFile)
const mockWriteFile = vi.mocked(writeFile)

describe("project-llm-settings", () => {
  const projectPath = "/data/wiki/PanGu-Wiki"

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns null when the project settings file does not exist", async () => {
    mockReadFile.mockRejectedValueOnce(new Error("missing"))

    await expect(loadProjectLlmSettings(projectPath)).resolves.toBeNull()
  })

  it("round-trips llm settings through the project settings file", async () => {
    const settings = {
      providerConfigs: {
        openai: {
          apiKey: "sk-test",
          model: "gpt-5",
          maxContextSize: 120000,
        },
      },
      activePresetId: "openai",
      llmConfig: {
        provider: "openai" as const,
        apiKey: "sk-test",
        model: "gpt-5",
        ollamaUrl: "",
        customEndpoint: "",
        maxContextSize: 120000,
      },
    }

    await saveProjectLlmSettings(projectPath, settings)

    expect(mockWriteFile).toHaveBeenCalledOnce()
    const [savedPath, savedJson] = mockWriteFile.mock.calls[0]
    expect(savedPath).toBe("/data/wiki/PanGu-Wiki/.llm-wiki/settings.json")

    mockReadFile.mockResolvedValueOnce(savedJson)

    await expect(loadProjectLlmSettings(projectPath)).resolves.toEqual(settings)
  })
})
