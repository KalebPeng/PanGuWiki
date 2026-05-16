import { create } from "zustand"
import {
  pushRecentCompleted,
  type TaskKind,
  type TaskStatus,
  type TaskViewModel,
} from "@/lib/tasks-model"
import { IngestSseClient } from "@/api/sse-client"

export type TasksStatusFilter = TaskStatus | "all"
export type TasksKindFilter = TaskKind | "all"

interface TasksState {
  selectedTaskId: string | null
  statusFilter: TasksStatusFilter
  kindFilter: TasksKindFilter
  recentCompleted: TaskViewModel[]
  sseClient: IngestSseClient | null
  setSelectedTaskId: (taskId: string | null) => void
  setStatusFilter: (filter: TasksStatusFilter) => void
  setKindFilter: (filter: TasksKindFilter) => void
  recordCompletedTask: (task: TaskViewModel) => void
  clearState: () => void
  startSseSubscription: (deptId: string, baseUrl: string) => void
  stopSseSubscription: () => void
}

const DEFAULT_STATE = {
  selectedTaskId: null,
  statusFilter: "all" as TasksStatusFilter,
  kindFilter: "all" as TasksKindFilter,
  recentCompleted: [] as TaskViewModel[],
  sseClient: null as IngestSseClient | null,
}

export const useTasksStore = create<TasksState>((set, get) => ({
  ...DEFAULT_STATE,

  setSelectedTaskId: (selectedTaskId) => set({ selectedTaskId }),
  setStatusFilter: (statusFilter) => set({ statusFilter }),
  setKindFilter: (kindFilter) => set({ kindFilter }),

  recordCompletedTask: (task) =>
    set((state) => ({
      recentCompleted: pushRecentCompleted(state.recentCompleted, task),
    })),

  clearState: () => {
    get().sseClient?.disconnect()
    set(DEFAULT_STATE)
  },

  startSseSubscription: (deptId: string, baseUrl: string) => {
    const { sseClient } = get()
    sseClient?.disconnect()

    const client = new IngestSseClient(deptId, baseUrl, (event) => {
      if (event.isSnapshot) return  // snapshots come from REST API initial load
      // Log progress events for now (full task state management is via REST polling)
      console.log('[SSE] Ingest event:', event.taskId, event.step, event.detail)
    })

    client.connect().catch(console.error)
    set({ sseClient: client })
  },

  stopSseSubscription: () => {
    get().sseClient?.disconnect()
    set({ sseClient: null })
  },
}))
