import { beforeEach, describe, expect, it } from "vitest"
import { useTasksStore } from "./tasks-store"
import type { TaskViewModel } from "@/lib/tasks-model"

function makeCompletedTask(id: string, updatedAt: number): TaskViewModel {
  return {
    id,
    kind: "research",
    source: "research-store",
    title: id,
    status: "done",
    detail: "Completed",
    createdAt: updatedAt,
    updatedAt,
    filesWritten: [],
    relatedPaths: [],
    canCancel: false,
    canRetry: false,
    rawRef: id,
  }
}

beforeEach(() => {
  useTasksStore.getState().clearState()
})

describe("tasks-store", () => {
  it("tracks session filters and selected task id", () => {
    const store = useTasksStore.getState()

    store.setSelectedTaskId("task-123")
    store.setStatusFilter("failed")
    store.setKindFilter("merge")

    const state = useTasksStore.getState()
    expect(state.selectedTaskId).toBe("task-123")
    expect(state.statusFilter).toBe("failed")
    expect(state.kindFilter).toBe("merge")
  })

  it("records recent completed tasks with de-duplication and a cap of 10", () => {
    const store = useTasksStore.getState()

    for (let index = 0; index < 10; index++) {
      store.recordCompletedTask(makeCompletedTask(`done-${index}`, index))
    }

    store.recordCompletedTask(makeCompletedTask("done-3", 103))
    store.recordCompletedTask({
      ...makeCompletedTask("ignore-running", 200),
      status: "running",
    })
    store.recordCompletedTask(makeCompletedTask("done-10", 110))

    expect(useTasksStore.getState().recentCompleted.map((task) => task.id)).toEqual([
      "done-10",
      "done-3",
      "done-9",
      "done-8",
      "done-7",
      "done-6",
      "done-5",
      "done-4",
      "done-2",
      "done-1",
    ])
  })

  it("clearState resets the session state back to defaults", () => {
    const store = useTasksStore.getState()
    store.setSelectedTaskId("task-123")
    store.setStatusFilter("queued")
    store.setKindFilter("ingest")
    store.recordCompletedTask(makeCompletedTask("done-1", 1))

    store.clearState()

    const state = useTasksStore.getState()
    expect(state.selectedTaskId).toBeNull()
    expect(state.statusFilter).toBe("all")
    expect(state.kindFilter).toBe("all")
    expect(state.recentCompleted).toEqual([])
  })
})
