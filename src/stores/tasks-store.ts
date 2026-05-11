import { create } from "zustand"
import {
  pushRecentCompleted,
  type TaskKind,
  type TaskStatus,
  type TaskViewModel,
} from "@/lib/tasks-model"

export type TasksStatusFilter = TaskStatus | "all"
export type TasksKindFilter = TaskKind | "all"

interface TasksState {
  selectedTaskId: string | null
  statusFilter: TasksStatusFilter
  kindFilter: TasksKindFilter
  recentCompleted: TaskViewModel[]
  setSelectedTaskId: (taskId: string | null) => void
  setStatusFilter: (filter: TasksStatusFilter) => void
  setKindFilter: (filter: TasksKindFilter) => void
  recordCompletedTask: (task: TaskViewModel) => void
  clearState: () => void
}

const DEFAULT_STATE = {
  selectedTaskId: null,
  statusFilter: "all" as TasksStatusFilter,
  kindFilter: "all" as TasksKindFilter,
  recentCompleted: [] as TaskViewModel[],
}

export const useTasksStore = create<TasksState>((set) => ({
  ...DEFAULT_STATE,

  setSelectedTaskId: (selectedTaskId) => set({ selectedTaskId }),
  setStatusFilter: (statusFilter) => set({ statusFilter }),
  setKindFilter: (kindFilter) => set({ kindFilter }),

  recordCompletedTask: (task) =>
    set((state) => ({
      recentCompleted: pushRecentCompleted(state.recentCompleted, task),
    })),

  clearState: () => set(DEFAULT_STATE),
}))
