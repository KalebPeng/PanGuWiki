import { describe, expect, it } from "vitest"
import { mapResearchTaskToViewModel } from "./tasks-model"

describe("mapResearchTaskToViewModel", () => {
  it("maps queued and active research statuses into task view statuses", () => {
    expect(
      mapResearchTaskToViewModel({
        id: "research-1",
        topic: "RoPE",
        status: "queued",
        webResults: [],
        synthesis: "",
        savedPath: null,
        error: null,
        createdAt: 1,
      }).status,
    ).toBe("queued")

    expect(
      mapResearchTaskToViewModel({
        id: "research-2",
        topic: "KV cache",
        status: "synthesizing",
        webResults: [],
        synthesis: "",
        savedPath: null,
        error: null,
        createdAt: 2,
      }).status,
    ).toBe("running")
  })
})
