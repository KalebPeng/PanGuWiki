import { describe, it, expect, beforeEach, vi } from "vitest"
import { flushMicrotasks } from "@/test-helpers/deferred"

// NOTE: processNext is a no-op on the frontend — ingest execution moved to
// the backend IngestWorkerService. These mocks are kept so cleanupWrittenFiles
// tests still work correctly; the autoIngest mock is no longer called during
// normal queue operation.

// Mock autoIngest (no longer called by processNext, kept for legacy compat).
vi.mock("./ingest", () => ({
  autoIngest: vi.fn(),
}))

// Mock fs so we don't hit the real filesystem.
vi.mock("@/commands/fs", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  listDirectory: vi.fn(),
  deleteFile: vi.fn(),
}))

// Mock sweep-reviews (no longer triggered by the frontend queue drain).
vi.mock("./sweep-reviews", () => ({
  sweepResolvedReviews: vi.fn().mockResolvedValue(0),
}))

// Mock embedding so cleanupWrittenFiles' cascade-delete to LanceDB is
// observable. The real module is over in `./embedding` but
// cleanupWrittenFiles dynamically imports it via `@/lib/embedding`,
// hence the absolute mock target.
const removePageEmbeddingMock = vi.fn<(projectPath: string, slug: string) => Promise<void>>(
  async () => {},
)
vi.mock("@/lib/embedding", () => ({
  removePageEmbedding: (projectPath: string, slug: string) =>
    removePageEmbeddingMock(projectPath, slug),
}))

// Mock project-identity — tests don't hit Tauri plugin-store. Maps the
// test UUIDs defined below back to their assigned paths.
const TEST_ID = "test-project-uuid"
const TEST_PATH = "/project"
const TEST_ID_B = "test-project-uuid-b"
const TEST_PATH_B = "/project-b"
const idToPath: Record<string, string> = {
  [TEST_ID]: TEST_PATH,
  [TEST_ID_B]: TEST_PATH_B,
}
vi.mock("@/lib/project-identity", () => ({
  ensureProjectId: vi.fn(),
  upsertProjectInfo: vi.fn(),
  getProjectPathById: vi.fn(async (id: string) => idToPath[id] ?? null),
  getProjectIdByPath: vi.fn(),
  loadRegistry: vi.fn(),
}))

import {
  enqueueIngest,
  enqueueBatch,
  retryTask,
  cancelTask,
  cancelAllTasks,
  clearCompletedTasks,
  clearQueueState,
  cleanupWrittenFiles,
  getQueue,
  getQueueSummary,
  restoreQueue,
} from "./ingest-queue"
import { readFile, writeFile } from "@/commands/fs"

const mockReadFile = vi.mocked(readFile)
const mockWriteFile = vi.mocked(writeFile)

/** Simulate the app having opened `TEST_ID` at `TEST_PATH` so the queue
 *  module's `currentProjectId` / `currentProjectPath` are set. Most
 *  tests need this — enqueue / retry / cancel guard against inactive
 *  projects. */
async function activateProject(id: string = TEST_ID): Promise<void> {
  await restoreQueue(id, idToPath[id])
}

beforeEach(async () => {
  clearQueueState()
  mockReadFile.mockReset()
  mockWriteFile.mockReset()
  removePageEmbeddingMock.mockReset()

  // Default: persisted queue file doesn't exist
  mockReadFile.mockRejectedValue(new Error("ENOENT"))
  mockWriteFile.mockResolvedValue(undefined as unknown as void)

  await activateProject()
})

describe("ingest-queue — enqueue & basic processing", () => {
  it("enqueueIngest adds a pending task (execution is handled by backend)", async () => {
    const id = await enqueueIngest(TEST_ID, "raw/sources/a.md")
    expect(id).toMatch(/^ingest-/)

    // processNext is a no-op: task remains pending (backend worker processes it)
    await flushMicrotasks(10)
    expect(getQueue()).toHaveLength(1)
    expect(getQueue()[0].status).toBe("pending")
  })

  it("persists queue to disk on enqueue", async () => {
    await enqueueIngest(TEST_ID, "a.md")
    await flushMicrotasks(2)

    // writeFile should have been called to save the queue
    const calls = mockWriteFile.mock.calls
    expect(calls.length).toBeGreaterThan(0)
    const queuePath = calls[0][0]
    expect(queuePath).toContain(".llm-wiki/ingest-queue.json")
  })

  it("enqueueBatch queues multiple tasks (execution is handled by backend)", async () => {
    await enqueueBatch(TEST_ID, [
      { sourcePath: "a.md", folderContext: "" },
      { sourcePath: "b.md", folderContext: "" },
      { sourcePath: "c.md", folderContext: "" },
    ])

    await flushMicrotasks(10)

    // Tasks remain pending — processNext is a no-op on the frontend
    expect(getQueue()).toHaveLength(3)
    for (const t of getQueue()) expect(t.status).toBe("pending")
  })
})

describe("ingest-queue — retry & failure", () => {
  it("retryTask resets a failed task to pending (backend will retry)", async () => {
    // Manually enqueue and force to failed state to simulate a backend-reported failure
    await enqueueIngest(TEST_ID, "bad.md")
    const task = getQueue()[0]
    ;(task as { status: string }).status = "failed"
    ;(task as { error: string | null }).error = "LLM error"
    ;(task as { retryCount: number }).retryCount = 3

    expect(getQueue()[0].status).toBe("failed")

    await retryTask(task.id)
    await flushMicrotasks(5)

    // retryTask sets status back to pending; backend picks it up
    expect(getQueue()[0].status).toBe("pending")
    expect(getQueue()[0].error).toBeNull()
  })
})

describe("ingest-queue — cancel", () => {
  it("cancelTask removes a pending task from the queue", async () => {
    await enqueueBatch(TEST_ID, [
      { sourcePath: "first.md", folderContext: "" },
      { sourcePath: "second.md", folderContext: "" },
    ])
    await flushMicrotasks(2)

    // Both tasks remain pending (no browser-side processing)
    const queue = getQueue()
    const second = queue.find((t) => t.sourcePath === "second.md")!
    await cancelTask(second.id)

    expect(getQueue().find((t) => t.sourcePath === "second.md")).toBeUndefined()
    expect(getQueue().find((t) => t.sourcePath === "first.md")).toBeDefined()
  })
})

describe("ingest-queue — cancelAllTasks", () => {
  it("drops all pending and processing tasks but keeps failed ones", async () => {
    await enqueueBatch(TEST_ID, [
      { sourcePath: "a.md", folderContext: "" },
      { sourcePath: "b.md", folderContext: "" },
      { sourcePath: "c.md", folderContext: "" },
    ])
    await flushMicrotasks(2)

    // Manually set one task to "failed" so we can verify it survives.
    const failedTask = getQueue()[2]
    ;(failedTask as { status: string }).status = "failed"

    const removed = await cancelAllTasks()

    expect(removed).toBe(2) // a (pending) + b (pending) gone
    expect(getQueue()).toHaveLength(1)
    expect(getQueue()[0].sourcePath).toBe("c.md")
    expect(getQueue()[0].status).toBe("failed")
  })

  it("returns 0 when the queue is empty", async () => {
    const removed = await cancelAllTasks()
    expect(removed).toBe(0)
    expect(getQueue()).toHaveLength(0)
  })

  it("is safe to call after it has already cleared the queue", async () => {
    await enqueueIngest(TEST_ID, "only.md")
    await flushMicrotasks(2)

    await cancelAllTasks()
    const secondCall = await cancelAllTasks()
    expect(secondCall).toBe(0)
  })
})

describe("ingest-queue — clearCompletedTasks & summary", () => {
  it("getQueueSummary returns accurate counts", async () => {
    await enqueueIngest(TEST_ID, "pending.md")
    // Manually set to failed (simulating backend reporting failure)
    ;(getQueue()[0] as { status: string }).status = "failed"

    const summary = getQueueSummary()
    expect(summary.failed).toBe(1)
    expect(summary.pending).toBe(0)
    expect(summary.total).toBe(1)
  })

  it("clearCompletedTasks drops failed tasks", async () => {
    await enqueueIngest(TEST_ID, "f.md")
    // Manually force to failed
    ;(getQueue()[0] as { status: string }).status = "failed"

    expect(getQueue()).toHaveLength(1)
    await clearCompletedTasks()
    expect(getQueue()).toHaveLength(0)
  })
})

describe("ingest-queue — queue-drain triggers review sweep", () => {
  it("does NOT trigger sweep on the frontend (execution moved to backend)", async () => {
    // processNext is a no-op: sweepResolvedReviews is never called from the frontend
    await enqueueIngest(TEST_ID, "ok.md")
    await flushMicrotasks(30)

    const { sweepResolvedReviews } = await import("./sweep-reviews")
    expect(vi.mocked(sweepResolvedReviews)).not.toHaveBeenCalled()
  })
})

describe("ingest-queue — clearQueueState", () => {
  it("clears pending tasks from memory", async () => {
    await enqueueBatch(TEST_ID, [
      { sourcePath: "a.md", folderContext: "" },
      { sourcePath: "b.md", folderContext: "" },
    ])
    await flushMicrotasks(2)

    expect(getQueue().length).toBeGreaterThan(0)

    clearQueueState()
    expect(getQueue()).toHaveLength(0)
  })
})

describe("ingest-queue — restoreQueue", () => {
  it("resets in-memory state before loading, preventing cross-project bleed", async () => {
    // Seed in-memory state from project A
    await enqueueIngest(TEST_ID, "a.md")
    await flushMicrotasks(2)
    expect(getQueue().length).toBeGreaterThan(0)

    // Now restore project B — should reset and load B's saved queue (empty)
    mockReadFile.mockRejectedValue(new Error("ENOENT"))
    await restoreQueue(TEST_ID_B, TEST_PATH_B)
    expect(getQueue()).toHaveLength(0)
  })

  it("converts 'processing' tasks back to 'pending' on restore (interrupted by app close)", async () => {
    const saved = [
      {
        id: "ingest-abc",
        sourcePath: "a.md",
        folderContext: "",
        status: "processing",
        addedAt: 0,
        error: null,
        retryCount: 0,
      },
    ]
    mockReadFile.mockResolvedValue(JSON.stringify(saved))

    await restoreQueue(TEST_ID, TEST_PATH)
    await flushMicrotasks(2)

    const queue = getQueue()
    expect(queue).toHaveLength(1)
    // processNext is a no-op: task stays as pending after restore
    expect(queue[0].status).toBe("pending")
  })

  it("leaves 'failed' tasks as failed on restore", async () => {
    const saved = [
      {
        id: "ingest-x",
        sourcePath: "x.md",
        folderContext: "",
        status: "failed",
        addedAt: 0,
        error: "prior failure",
        retryCount: 3,
      },
    ]
    mockReadFile.mockResolvedValue(JSON.stringify(saved))

    await restoreQueue(TEST_ID, TEST_PATH)
    const queue = getQueue()
    expect(queue).toHaveLength(1)
    expect(queue[0].status).toBe("failed")
    expect(queue[0].error).toBe("prior failure")
  })

  it("backfills projectId on older task files that predate the field", async () => {
    // Disk written before projectId was part of the schema.
    const savedLegacy = [
      {
        id: "ingest-legacy",
        sourcePath: "legacy.md",
        folderContext: "",
        status: "pending",
        addedAt: 0,
        error: null,
        retryCount: 0,
      },
    ]
    mockReadFile.mockResolvedValue(JSON.stringify(savedLegacy))

    await restoreQueue(TEST_ID, TEST_PATH)
    const queue = getQueue()
    expect(queue).toHaveLength(1)
    expect(queue[0].projectId).toBe(TEST_ID)
  })
})

import { pauseQueue } from "./ingest-queue"

describe("ingest-queue — pauseQueue & switch-project survival", () => {
  it("pauseQueue persists pending tasks to the paused project's disk", async () => {
    await enqueueBatch(TEST_ID, [
      { sourcePath: "a.md", folderContext: "" },
      { sourcePath: "b.md", folderContext: "" },
    ])
    await flushMicrotasks(2)
    mockWriteFile.mockClear()

    await pauseQueue()

    // The last write call should contain BOTH pending tasks.
    const writes = mockWriteFile.mock.calls
    expect(writes.length).toBeGreaterThan(0)
    const [pathArg, contentArg] = writes[writes.length - 1]
    expect(String(pathArg)).toContain("/project/.llm-wiki/ingest-queue.json")
    const persisted = JSON.parse(String(contentArg)) as Array<{ status: string }>
    expect(persisted).toHaveLength(2)
    for (const t of persisted) expect(t.status).toBe("pending")
  })

  it("pauseQueue then restoreQueue of SAME project brings tasks back", async () => {
    await enqueueIngest(TEST_ID, "first.md")
    await flushMicrotasks(2)

    // Capture what pauseQueue writes so restore can read it back.
    let lastWrittenContent = ""
    mockWriteFile.mockImplementation(async (_path: string, content: string) => {
      lastWrittenContent = content
    })
    await pauseQueue()

    // Simulate reloading that same project: disk returns what we just wrote.
    mockReadFile.mockResolvedValue(lastWrittenContent)
    await restoreQueue(TEST_ID, TEST_PATH)

    const queue = getQueue()
    expect(queue).toHaveLength(1)
    expect(queue[0].sourcePath).toBe("first.md")
  })

  it("switch project: restored B queue is empty and uncontaminated by A's tasks", async () => {
    await enqueueIngest(TEST_ID, "long-running.md")
    await flushMicrotasks(2)

    // Switch projects: pause A then restore B.
    mockWriteFile.mockClear()
    await pauseQueue()
    await restoreQueue(TEST_ID_B, TEST_PATH_B)

    // B's queue should be empty — no tasks from A leaked in.
    expect(getQueue()).toHaveLength(0)

    // Confirm B's queue file was written as empty array.
    const bWrites = mockWriteFile.mock.calls.filter(([p]) => String(p).includes("/project-b/"))
    for (const [, content] of bWrites) {
      const parsed = JSON.parse(String(content))
      expect(parsed).toEqual([])
    }
  })
})

// ── cleanupWrittenFiles — file delete + LanceDB chunk cascade ──────
describe("cleanupWrittenFiles — embedding cascade", () => {
  it("deletes each file AND drops its embedding chunks (relative paths)", async () => {
    const { deleteFile } = await import("@/commands/fs")
    const mockDeleteFile = vi.mocked(deleteFile)
    mockDeleteFile.mockReset()
    mockDeleteFile.mockResolvedValue(undefined)

    await cleanupWrittenFiles("/proj", [
      "wiki/concepts/rope.md",
      "wiki/entities/transformer.md",
    ])

    // File deletes use joined absolute paths.
    expect(mockDeleteFile).toHaveBeenCalledTimes(2)
    expect(mockDeleteFile).toHaveBeenNthCalledWith(1, "/proj/wiki/concepts/rope.md")
    expect(mockDeleteFile).toHaveBeenNthCalledWith(2, "/proj/wiki/entities/transformer.md")

    // Embedding cascade uses page slugs (basename minus .md).
    expect(removePageEmbeddingMock).toHaveBeenCalledTimes(2)
    expect(removePageEmbeddingMock).toHaveBeenNthCalledWith(1, "/proj", "rope")
    expect(removePageEmbeddingMock).toHaveBeenNthCalledWith(2, "/proj", "transformer")
  })

  it("uses absolute paths verbatim (doesn't double-prefix the project path)", async () => {
    const { deleteFile } = await import("@/commands/fs")
    const mockDeleteFile = vi.mocked(deleteFile)
    mockDeleteFile.mockReset()
    mockDeleteFile.mockResolvedValue(undefined)

    await cleanupWrittenFiles("/proj", ["/abs/elsewhere/wiki/concepts/foo.md"])

    expect(mockDeleteFile).toHaveBeenCalledWith("/abs/elsewhere/wiki/concepts/foo.md")
    // Slug derivation still works on absolute paths.
    expect(removePageEmbeddingMock).toHaveBeenCalledWith("/proj", "foo")
  })

  it("continues to subsequent files when one delete throws", async () => {
    const { deleteFile } = await import("@/commands/fs")
    const mockDeleteFile = vi.mocked(deleteFile)
    mockDeleteFile.mockReset()
    // First file fails (e.g. already gone), second succeeds.
    mockDeleteFile
      .mockRejectedValueOnce(new Error("ENOENT"))
      .mockResolvedValueOnce(undefined)

    await cleanupWrittenFiles("/proj", [
      "wiki/concepts/missing.md",
      "wiki/concepts/present.md",
    ])

    // Both deleteFile attempts happened — the helper kept going.
    expect(mockDeleteFile).toHaveBeenCalledTimes(2)
    // First file's embedding cascade was skipped (deleteFile threw),
    // second file's cascade still ran.
    expect(removePageEmbeddingMock).toHaveBeenCalledTimes(1)
    expect(removePageEmbeddingMock).toHaveBeenCalledWith("/proj", "present")
  })

  it("swallows removePageEmbedding errors so a LanceDB issue doesn't abort cleanup", async () => {
    const { deleteFile } = await import("@/commands/fs")
    const mockDeleteFile = vi.mocked(deleteFile)
    mockDeleteFile.mockReset()
    mockDeleteFile.mockResolvedValue(undefined)

    // First page's embedding cascade throws; second succeeds.
    removePageEmbeddingMock
      .mockRejectedValueOnce(new Error("lancedb unavailable"))
      .mockResolvedValueOnce(undefined)

    await cleanupWrittenFiles("/proj", [
      "wiki/concepts/a.md",
      "wiki/concepts/b.md",
    ])

    // Both file deletes still happened.
    expect(mockDeleteFile).toHaveBeenCalledTimes(2)
    // Second cascade still attempted despite first throwing.
    expect(removePageEmbeddingMock).toHaveBeenCalledTimes(2)
  })

  it("handles Windows backslash paths via getFileStem", async () => {
    const { deleteFile } = await import("@/commands/fs")
    const mockDeleteFile = vi.mocked(deleteFile)
    mockDeleteFile.mockReset()
    mockDeleteFile.mockResolvedValue(undefined)

    // A path that's been rewritten with backslashes (Windows ingest
    // pipeline output before normalize). getFileStem must still
    // pull "rope" out cleanly so the cascade hits the right page.
    await cleanupWrittenFiles("C:/proj", ["wiki\\concepts\\rope.md"])

    expect(removePageEmbeddingMock).toHaveBeenCalledWith("C:/proj", "rope")
  })
})
