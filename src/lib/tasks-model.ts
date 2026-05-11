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

interface MergeTaskSnapshotsArgs {
  queued?: readonly TaskViewModel[]
  activity?: readonly TaskViewModel[]
}

const STATUS_SORT_ORDER: Record<TaskStatus, number> = {
  running: 0,
  queued: 1,
  failed: 2,
  done: 3,
}

const RECENT_COMPLETED_LIMIT = 10

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

function taskTimestamp(task: TaskViewModel): number {
  return task.updatedAt ?? task.createdAt
}

function isMatchingIngestActivity(task: TaskViewModel, queued: readonly TaskViewModel[]): boolean {
  if (task.source !== "activity-store" || task.kind !== "ingest") return false

  return queued.some((candidate) =>
    candidate.source === "ingest-queue" &&
    candidate.kind === "ingest" &&
    candidate.title === task.title,
  )
}

export function mergeTaskSnapshots({
  queued = [],
  activity = [],
}: MergeTaskSnapshotsArgs): TaskViewModel[] {
  const merged = [
    ...queued,
    ...activity.filter((task) => !isMatchingIngestActivity(task, queued)),
  ]

  return [...merged].sort((left, right) => {
    const bucketDelta = STATUS_SORT_ORDER[left.status] - STATUS_SORT_ORDER[right.status]
    if (bucketDelta !== 0) return bucketDelta
    return taskTimestamp(right) - taskTimestamp(left)
  })
}

export function pushRecentCompleted(
  items: readonly TaskViewModel[],
  incoming: readonly TaskViewModel[],
): TaskViewModel[] {
  const completedIncoming = [...incoming]
    .filter((task) => task.status === "done")
    .sort((left, right) => taskTimestamp(right) - taskTimestamp(left))

  const seen = new Set<string>()
  const next: TaskViewModel[] = []

  for (const task of [...completedIncoming, ...items]) {
    if (task.status !== "done" || seen.has(task.id)) continue
    seen.add(task.id)
    next.push(task)
    if (next.length === RECENT_COMPLETED_LIMIT) break
  }

  return next
}
