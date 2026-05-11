import type { ResearchTask } from "@/stores/research-store"

export type TaskKind = "ingest" | "research" | "merge" | "maintenance"
export type TaskStatus = "running" | "queued" | "failed" | "done"

export interface TaskViewModel {
  id: string
  kind: TaskKind
  source: string
  title: string
  status: TaskStatus
  detail: string
  createdAt: number
  updatedAt?: number
  error?: string
  progressLabel?: string
  filesWritten: number
  relatedPaths: string[]
  canCancel: boolean
  canRetry: boolean
  rawRef?: unknown
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
  done: "Done",
}

export function mapResearchTaskToViewModel(task: ResearchTask): TaskViewModel {
  const status = RESEARCH_STATUS_MAP[task.status]
  const relatedPaths = task.savedPath ? [task.savedPath] : []

  return {
    id: task.id,
    kind: "research",
    source: "research",
    title: task.topic,
    status,
    detail: task.topic,
    createdAt: task.createdAt,
    error: task.error ?? undefined,
    progressLabel: RESEARCH_PROGRESS_LABELS[task.status],
    filesWritten: relatedPaths.length,
    relatedPaths,
    canCancel: status === "queued" || status === "running",
    canRetry: status === "failed",
    rawRef: task,
  }
}
