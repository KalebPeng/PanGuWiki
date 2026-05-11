import { describe, expect, it } from "vitest"
import { mapResearchTaskToViewModel } from "./tasks-model"

describe("mapResearchTaskToViewModel", () => {
  it("maps research tasks into the normalized tasks contract", () => {
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
      }),
    ).toMatchObject({
      kind: "research",
      source: "research-store",
      status: "queued",
      detail: "Queued",
      filesWritten: [],
      relatedPaths: [],
      canCancel: false,
      canRetry: false,
      rawRef: "research-1",
    })

    expect(
      mapResearchTaskToViewModel({
        id: "research-2a",
        topic: "KV cache",
        status: "synthesizing",
        webResults: [],
        synthesis: "",
        savedPath: null,
        error: null,
        createdAt: 2,
      }),
    ).toMatchObject({
      kind: "research",
      source: "research-store",
      status: "running",
      detail: "Synthesizing",
      filesWritten: [],
      relatedPaths: [],
      canCancel: false,
      canRetry: false,
      rawRef: "research-2a",
    })

    expect(
      mapResearchTaskToViewModel({
        id: "research-2",
        topic: "KV cache",
        status: "done",
        webResults: [],
        synthesis: "",
        savedPath: "wiki/research/kv-cache.md",
        error: null,
        createdAt: 2,
      }),
    ).toMatchObject({
      kind: "research",
      source: "research-store",
      status: "done",
      detail: "Completed",
      filesWritten: ["wiki/research/kv-cache.md"],
      relatedPaths: ["wiki/research/kv-cache.md"],
      canCancel: false,
      canRetry: false,
      rawRef: "research-2",
    })
  })
})
