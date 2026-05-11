import type { ResearchTask } from "@/stores/research-store"
import type { IngestTask } from "@/lib/ingest-queue"
import type { DedupTask } from "@/lib/dedup-queue"
import type { ActivityItem } from "@/stores/activity-store"

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
  recentCompleted?: readonly TaskViewModel[]
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

function isIngestTask(task: TaskViewModel): boolean {
  return task.kind === "ingest" && (
    task.source === "ingest-queue" || task.source === "activity-store"
  )
}

function ingestMatchKey(task: TaskViewModel): string | null {
  return isIngestTask(task) ? task.title : null
}

function mergeTaskPaths(primary: readonly string[], secondary: readonly string[]): string[] {
  return secondary.length > 0 ? [...secondary] : [...primary]
}

function mergeIngestTask(queueTask: TaskViewModel, activityTask: TaskViewModel): TaskViewModel {
  return {
    ...queueTask,
    detail: activityTask.detail || queueTask.detail,
    updatedAt: Math.max(taskTimestamp(queueTask), taskTimestamp(activityTask)),
    error: activityTask.error ?? queueTask.error,
    progressLabel: activityTask.progressLabel ?? queueTask.progressLabel,
    filesWritten: mergeTaskPaths(queueTask.filesWritten, activityTask.filesWritten),
    relatedPaths: mergeTaskPaths(queueTask.relatedPaths, activityTask.relatedPaths),
  }
}

function buildSafeIngestMatches(
  queued: readonly TaskViewModel[],
  activity: readonly TaskViewModel[],
): Map<string, TaskViewModel> {
  const ingestQueued = queued.filter((task) => task.source === "ingest-queue" && task.kind === "ingest")
  const ingestActivity = activity.filter((task) => task.source === "activity-store" && task.kind === "ingest")
  const queueCounts = new Map<string, number>()
  const activityCounts = new Map<string, number>()

  for (const task of ingestQueued) {
    const key = ingestMatchKey(task)
    if (!key) continue
    queueCounts.set(key, (queueCounts.get(key) ?? 0) + 1)
  }

  for (const task of ingestActivity) {
    const key = ingestMatchKey(task)
    if (!key) continue
    activityCounts.set(key, (activityCounts.get(key) ?? 0) + 1)
  }

  const activityByKey = new Map(
    ingestActivity.map((task) => [ingestMatchKey(task), task] as const),
  )
  const matches = new Map<string, TaskViewModel>()

  for (const task of ingestQueued) {
    const key = ingestMatchKey(task)
    if (!key) continue
    if (queueCounts.get(key) !== 1 || activityCounts.get(key) !== 1) continue
    // Basenames are not stable identities. We only merge the one-to-one
    // pair when both sides are the live in-flight representation; any
    // stale/completed row with the same basename stays separate on purpose.
    if (task.status !== "running") continue

    const activityTask = activityByKey.get(key)
    if (activityTask && activityTask.status === "running") {
      matches.set(task.id, activityTask)
    }
  }

  return matches
}

export function mergeTaskSnapshots({
  queued = [],
  activity = [],
  recentCompleted = [],
}: MergeTaskSnapshotsArgs): TaskViewModel[] {
  const safeIngestMatches = buildSafeIngestMatches(queued, activity)
  const matchedActivityIds = new Set(
    [...safeIngestMatches.values()].map((task) => task.id),
  )

  const mergedQueued = queued.map((task) => {
    const activityMatch = safeIngestMatches.get(task.id)
    return activityMatch ? mergeIngestTask(task, activityMatch) : task
  })

  const activeItems = [
    ...mergedQueued,
    ...activity.filter((task) => !matchedActivityIds.has(task.id)),
  ]
  const activeIds = new Set(activeItems.map((task) => task.id))
  const merged = [
    ...activeItems,
    ...recentCompleted.filter((task) => !activeIds.has(task.id)),
  ]

  return [...merged].sort((left, right) => {
    const bucketDelta = STATUS_SORT_ORDER[left.status] - STATUS_SORT_ORDER[right.status]
    if (bucketDelta !== 0) return bucketDelta
    return taskTimestamp(right) - taskTimestamp(left)
  })
}

export function applyTaskFilters(
  tasks: TaskViewModel[],
  statusFilter: "all" | TaskStatus,
  kindFilter: "all" | TaskKind,
): TaskViewModel[] {
  return tasks.filter((task) => {
    const statusOk = statusFilter === "all" || task.status === statusFilter
    const kindOk = kindFilter === "all" || task.kind === kindFilter
    return statusOk && kindOk
  })
}

const INGEST_STATUS_MAP: Record<IngestTask["status"], TaskStatus> = {
  pending: "queued",
  processing: "running",
  done: "done",
  failed: "failed",
}

export function mapIngestTaskToViewModel(task: IngestTask): TaskViewModel {
  const status = INGEST_STATUS_MAP[task.status]
  const filename = task.sourcePath.split("/").pop() ?? task.sourcePath
  return {
    id: task.id,
    kind: "ingest",
    source: "ingest-queue",
    title: filename,
    status,
    detail: task.folderContext || task.sourcePath,
    createdAt: task.addedAt,
    error: task.error ?? undefined,
    filesWritten: [],
    relatedPaths: [],
    canCancel: task.status === "pending" || task.status === "processing",
    canRetry: task.status === "failed",
    rawRef: task.id,
  }
}

const DEDUP_STATUS_MAP: Record<DedupTask["status"], TaskStatus> = {
  pending: "queued",
  processing: "running",
  done: "done",
  failed: "failed",
}

export function mapDedupTaskToViewModel(task: DedupTask): TaskViewModel {
  const status = DEDUP_STATUS_MAP[task.status]
  return {
    id: task.id,
    kind: "merge",
    source: "dedup-queue",
    title: task.canonicalSlug,
    status,
    detail: `Merge ${task.group.slugs.length} pages → ${task.canonicalSlug}`,
    createdAt: task.addedAt,
    error: task.error ?? undefined,
    filesWritten: [],
    relatedPaths: [],
    canCancel: task.status === "pending" || task.status === "processing",
    canRetry: task.status === "failed",
    rawRef: task.id,
  }
}

const ACTIVITY_KIND_MAP: Record<ActivityItem["type"], TaskKind> = {
  ingest: "ingest",
  lint: "maintenance",
  query: "research",
  maintenance: "maintenance",
}

const ACTIVITY_STATUS_MAP: Record<ActivityItem["status"], TaskStatus> = {
  running: "running",
  done: "done",
  error: "failed",
}

export function mapActivityItemToViewModel(item: ActivityItem): TaskViewModel {
  return {
    id: item.id,
    kind: ACTIVITY_KIND_MAP[item.type] ?? "maintenance",
    source: "activity-store",
    title: item.title,
    status: ACTIVITY_STATUS_MAP[item.status],
    detail: item.detail,
    createdAt: item.createdAt,
    filesWritten: item.filesWritten,
    relatedPaths: item.filesWritten,
    canCancel: false,
    canRetry: false,
  }
}

export function pushRecentCompleted(
  items: readonly TaskViewModel[],
  incoming: TaskViewModel,
): TaskViewModel[] {
  if (incoming.status !== "done") {
    return [...items]
  }

  const seen = new Set<string>()
  const next: TaskViewModel[] = []

  for (const task of [incoming, ...items]) {
    if (task.status !== "done" || seen.has(task.id)) continue
    seen.add(task.id)
    next.push(task)
    if (next.length === RECENT_COMPLETED_LIMIT) break
  }

  return next
}
