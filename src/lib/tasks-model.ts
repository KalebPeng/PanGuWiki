import type { ResearchTask } from "@/stores/research-store"

export type TaskKind = "ingest" | "research" | "merge" | "maintenance"
export type TaskStatus = "running" | "queued" | "failed" | "done"
export type TaskSource = "ingest-queue" | "dedup-queue" | "research-store" | "activity-store"
export type TaskRawRef = string

export interface TaskViewModel {
  id: string
  kind: TaskKind
  source: TaskSource
  title: string
  status: TaskStatus
  detail: string
  createdAt: number
  updatedAt?: number
  error?: string
  progressLabel?: string
  filesWritten: string[]
  relatedPaths: string[]
  canCancel: boolean
  canRetry: boolean
  rawRef?: TaskRawRef
}

const RESEARCH_STATUS_MAP: Record<ResearchTask["status"], TaskStatus> = {
  queued: "queued",
  searching: "running",
  synthesizing: "running",
  saving: "running",
  done: "done",
  error: "failed",
}

const RESEARCH_PROGRESS_LABELS: Partial<Record<ResearchTask["status"], string>> = {
  queued: "Queued",
  searching: "Searching web",
  synthesizing: "Synthesizing",
  saving: "Saving notes",
  done: "Completed",
  error: "Failed",
}

export function mapResearchTaskToViewModel(task: ResearchTask): TaskViewModel {
  const status = RESEARCH_STATUS_MAP[task.status]
  const filesWritten = task.savedPath ? [task.savedPath] : []
  const detail = RESEARCH_PROGRESS_LABELS[task.status] ?? task.status

  return {
    id: task.id,
    kind: "research",
    source: "research-store",
    title: task.topic,
    status,
    detail,
    createdAt: task.createdAt,
    error: task.error ?? undefined,
    progressLabel: detail,
    filesWritten,
    relatedPaths: filesWritten,
    canCancel: false,
    canRetry: false,
    rawRef: task.id,
  }
}
