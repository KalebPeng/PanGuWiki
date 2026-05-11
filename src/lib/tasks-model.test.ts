import { describe, expect, it } from "vitest"
import {
  mapResearchTaskToViewModel,
  mergeTaskSnapshots,
  pushRecentCompleted,
  type TaskViewModel,
} from "./tasks-model"

function makeTask(overrides: Partial<TaskViewModel> & Pick<TaskViewModel, "id">): TaskViewModel {
  return {
    kind: "research",
    source: "research-store",
    title: overrides.id,
    status: "queued",
    detail: "detail",
    createdAt: 0,
    filesWritten: [],
    relatedPaths: [],
    canCancel: false,
    canRetry: false,
    ...overrides,
  }
}

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

describe("mergeTaskSnapshots", () => {
  it("de-duplicates matching ingest queue and activity rows, then sorts by status bucket and recency", () => {
    const merged = mergeTaskSnapshots({
      queued: [
        makeTask({
          id: "ingest-running",
          kind: "ingest",
          source: "ingest-queue",
          title: "paper.pdf",
          status: "running",
          createdAt: 10,
          updatedAt: 60,
          rawRef: "ingest-running",
          canCancel: true,
        }),
        makeTask({
          id: "ingest-queued",
          kind: "ingest",
          source: "ingest-queue",
          title: "book.pdf",
          status: "queued",
          createdAt: 20,
          rawRef: "ingest-queued",
          canCancel: true,
        }),
        makeTask({
          id: "merge-failed",
          kind: "merge",
          source: "dedup-queue",
          title: "Duplicate merge",
          status: "failed",
          createdAt: 30,
          updatedAt: 55,
          rawRef: "merge-failed",
          canRetry: true,
        }),
      ],
      activity: [
        makeTask({
          id: "activity-older-running",
          kind: "ingest",
          source: "activity-store",
          title: "paper.pdf",
          status: "running",
          createdAt: 40,
          updatedAt: 50,
          rawRef: "activity-older-running",
        }),
        makeTask({
          id: "activity-done-newer",
          kind: "maintenance",
          source: "activity-store",
          title: "Cleanup",
          status: "done",
          createdAt: 35,
          updatedAt: 70,
          rawRef: "activity-done-newer",
        }),
        makeTask({
          id: "activity-done-older",
          kind: "maintenance",
          source: "activity-store",
          title: "Sweep",
          status: "done",
          createdAt: 34,
          updatedAt: 45,
          rawRef: "activity-done-older",
        }),
      ],
    })

    expect(merged.map((task) => task.id)).toEqual([
      "ingest-running",
      "ingest-queued",
      "merge-failed",
      "activity-done-newer",
      "activity-done-older",
    ])
    expect(merged.find((task) => task.id === "activity-older-running")).toBeUndefined()
  })
})

describe("pushRecentCompleted", () => {
  it("prepends newly completed tasks, de-duplicates by id, and trims the buffer to 10 items", () => {
    const existing = Array.from({ length: 10 }, (_, index) =>
      makeTask({
        id: `done-${index}`,
        status: "done",
        createdAt: index,
        updatedAt: index,
      }),
    )

    const next = pushRecentCompleted(existing, [
      makeTask({
        id: "done-3",
        status: "done",
        createdAt: 3,
        updatedAt: 300,
      }),
      makeTask({
        id: "done-11",
        status: "done",
        createdAt: 11,
        updatedAt: 311,
      }),
      makeTask({
        id: "running-ignore",
        status: "running",
        createdAt: 12,
        updatedAt: 312,
      }),
    ])

    expect(next).toHaveLength(10)
    expect(next.map((task) => task.id)).toEqual([
      "done-11",
      "done-3",
      "done-0",
      "done-1",
      "done-2",
      "done-4",
      "done-5",
      "done-6",
      "done-7",
      "done-8",
    ])
  })
})
