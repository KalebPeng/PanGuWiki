import { useEffect, useMemo, useState } from "react"
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Clock,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  getQueue as getIngestQueue,
  retryTask as retryIngestTask,
  cancelTask as cancelIngestTask,
  type IngestTask,
} from "@/lib/ingest-queue"
import {
  getQueue as getMergeQueue,
  retryTask as retryMergeTask,
  cancelTask as cancelMergeTask,
  type DedupTask,
} from "@/lib/dedup-queue"
import { useResearchStore } from "@/stores/research-store"
import { useActivityStore } from "@/stores/activity-store"
import { useTasksStore } from "@/stores/tasks-store"
import { useOrgStore } from "@/stores/org-store"
import { httpGet } from "@/api/dotnet-client"
import {
  applyTaskFilters,
  mapActivityItemToViewModel,
  mapDedupTaskToViewModel,
  mapIngestTaskToViewModel,
  mapResearchTaskToViewModel,
  mergeTaskSnapshots,
  type TaskKind,
  type TaskStatus,
  type TaskViewModel,
} from "@/lib/tasks-model"

// ── DB Ingest Task types ──────────────────────────────────────────────────

interface DbIngestTask {
  id: string
  source_file_name: string
  source_file_path: string
  status: string  // queued | running | done | failed
  wiki_pages_count: number | null
  triggered_by: string | null
  queued_at: string
  started_at: string | null
  completed_at: string | null
  error_message: string | null
}

function dbTaskToViewModel(t: DbIngestTask): TaskViewModel {
  return {
    id: `db-${t.id}`,
    kind: "ingest",
    source: "activity-store",
    title: t.source_file_name,
    status: t.status === "done" ? "done"
          : t.status === "failed" ? "failed"
          : t.status === "running" ? "running"
          : "queued",
    detail: t.status === "done"
          ? `${t.wiki_pages_count ?? 0} 个页面写入 Wiki`
          : t.error_message ?? "",
    createdAt: new Date(t.queued_at).getTime(),
    updatedAt: t.completed_at ? new Date(t.completed_at).getTime() : undefined,
    filesWritten: [],
    relatedPaths: [t.source_file_path],
    canCancel: false,
    canRetry: false,
  }
}

function useDbIngestTasks(activeDeptId: string | null): DbIngestTask[] {
  const [dbTasks, setDbTasks] = useState<DbIngestTask[]>([])

  useEffect(() => {
    if (!activeDeptId) return
    httpGet<DbIngestTask[]>(`/api/departments/${activeDeptId}/ingest-tasks`)
      .then(setDbTasks)
      .catch(() => {})
  }, [activeDeptId])

  return dbTasks
}

// ── Status + kind metadata ────────────────────────────────────────────────

const STATUS_LABELS: Record<TaskStatus, string> = {
  running: "运行中",
  queued: "排队中",
  failed: "失败",
  done: "完成",
}

const STATUS_COLORS: Record<TaskStatus, string> = {
  running: "text-blue-500",
  queued: "text-amber-500",
  failed: "text-destructive",
  done: "text-green-500",
}

const STATUS_BG: Record<TaskStatus, string> = {
  running: "bg-blue-500/10 text-blue-600",
  queued: "bg-amber-500/10 text-amber-600",
  failed: "bg-destructive/10 text-destructive",
  done: "bg-green-500/10 text-green-600",
}

const KIND_LABELS: Record<TaskKind, string> = {
  ingest: "导入",
  research: "研究",
  merge: "合并",
  maintenance: "维护",
}

const KIND_BG: Record<TaskKind, string> = {
  ingest: "bg-violet-500/10 text-violet-600",
  research: "bg-sky-500/10 text-sky-600",
  merge: "bg-orange-500/10 text-orange-600",
  maintenance: "bg-slate-500/10 text-slate-600",
}

// ── Helpers ───────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: TaskStatus }) {
  if (status === "running") return <Loader2 className={`h-3.5 w-3.5 shrink-0 animate-spin ${STATUS_COLORS[status]}`} />
  if (status === "failed") return <AlertCircle className={`h-3.5 w-3.5 shrink-0 ${STATUS_COLORS[status]}`} />
  if (status === "done") return <CheckCircle2 className={`h-3.5 w-3.5 shrink-0 ${STATUS_COLORS[status]}`} />
  return <Clock className={`h-3.5 w-3.5 shrink-0 ${STATUS_COLORS[status]}`} />
}

function Chip({ label, className }: { label: string; className: string }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${className}`}>
      {label}
    </span>
  )
}

function runTaskAction(task: TaskViewModel, action: "cancel" | "retry") {
  if (task.kind === "ingest") {
    if (action === "retry") retryIngestTask(task.rawRef ?? task.id)
    if (action === "cancel") cancelIngestTask(task.rawRef ?? task.id)
  }
  if (task.kind === "merge") {
    if (action === "retry") retryMergeTask(task.rawRef ?? task.id)
    if (action === "cancel") cancelMergeTask(task.rawRef ?? task.id)
  }
}

// ── Sub-components ────────────────────────────────────────────────────────

function SummaryCard({
  label,
  count,
  status,
  active,
  onClick,
}: {
  label: string
  count: number
  status: TaskStatus
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 flex-col items-center gap-0.5 rounded-lg border p-3 transition-colors hover:bg-accent ${active ? "border-primary bg-accent" : ""}`}
    >
      <span className={`text-xl font-semibold tabular-nums ${STATUS_COLORS[status]}`}>{count}</span>
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </button>
  )
}

function TaskRow({
  task,
  selected,
  onClick,
}: {
  task: TaskViewModel
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`group flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent ${selected ? "bg-accent" : ""}`}
    >
      <StatusDot status={task.status} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{task.title}</span>
        <span className="block truncate text-xs text-muted-foreground">{task.progressLabel ?? task.detail}</span>
      </span>
      <Chip label={KIND_LABELS[task.kind]} className={KIND_BG[task.kind]} />
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50 group-hover:text-muted-foreground" />
    </button>
  )
}

function TaskDetail({ task }: { task: TaskViewModel }) {
  const ts = (n: number) => new Date(n).toLocaleTimeString()

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div>
        <p className="text-xs text-muted-foreground">{KIND_LABELS[task.kind]}</p>
        <h3 className="mt-0.5 break-all text-sm font-semibold leading-snug">{task.title}</h3>
      </div>

      <div className="flex flex-wrap gap-2">
        <Chip label={STATUS_LABELS[task.status]} className={STATUS_BG[task.status]} />
        <Chip label={KIND_LABELS[task.kind]} className={KIND_BG[task.kind]} />
      </div>

      {task.progressLabel && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">进度</p>
          <p className="mt-0.5 text-sm">{task.progressLabel}</p>
        </div>
      )}

      {task.detail && task.detail !== task.progressLabel && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">详情</p>
          <p className="mt-0.5 break-all text-xs text-muted-foreground">{task.detail}</p>
        </div>
      )}

      {task.error && (
        <div className="rounded-md bg-destructive/10 p-3">
          <p className="text-xs font-medium text-destructive">错误</p>
          <p className="mt-1 break-all text-xs text-destructive">{task.error}</p>
        </div>
      )}

      {task.filesWritten.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">已写入文件</p>
          <ul className="space-y-0.5">
            {task.filesWritten.map((f) => (
              <li key={f} className="truncate text-xs text-muted-foreground">
                {f.split("/").pop()}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="text-xs text-muted-foreground">
        创建: {ts(task.createdAt)}
        {task.updatedAt && task.updatedAt !== task.createdAt && (
          <span className="ml-3">更新: {ts(task.updatedAt)}</span>
        )}
      </div>

      {(task.canCancel || task.canRetry) && (
        <div className="mt-auto flex gap-2">
          {task.canRetry && (
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              onClick={() => runTaskAction(task, "retry")}
            >
              <RefreshCw className="mr-1 h-3.5 w-3.5" />
              重试
            </Button>
          )}
          {task.canCancel && (
            <Button
              size="sm"
              variant="outline"
              className="flex-1 text-destructive hover:text-destructive"
              onClick={() => runTaskAction(task, "cancel")}
            >
              <X className="mr-1 h-3.5 w-3.5" />
              取消
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────

export function TasksView() {
  const [ingestQueue, setIngestQueue] = useState<readonly IngestTask[]>(() => getIngestQueue())
  const [mergeQueue, setMergeQueue] = useState<readonly DedupTask[]>(() => getMergeQueue())

  useEffect(() => {
    const id = setInterval(() => {
      setIngestQueue(getIngestQueue())
      setMergeQueue(getMergeQueue())
    }, 1000)
    return () => clearInterval(id)
  }, [])

  const researchTasks = useResearchStore((s) => s.tasks)
  const activityItems = useActivityStore((s) => s.items)
  const recentCompleted = useTasksStore((s) => s.recentCompleted)
  const selectedTaskId = useTasksStore((s) => s.selectedTaskId)
  const setSelectedTaskId = useTasksStore((s) => s.setSelectedTaskId)
  const statusFilter = useTasksStore((s) => s.statusFilter)
  const setStatusFilter = useTasksStore((s) => s.setStatusFilter)
  const kindFilter = useTasksStore((s) => s.kindFilter)
  const setKindFilter = useTasksStore((s) => s.setKindFilter)

  const activeDeptId = useOrgStore((s) => s.activeDeptId)
  const dbTasksRaw = useDbIngestTasks(activeDeptId)

  const tasks = useMemo(() => {
    const memoryTasks = mergeTaskSnapshots({
      queued: [
        ...ingestQueue.map(mapIngestTaskToViewModel),
        ...mergeQueue.map(mapDedupTaskToViewModel),
        ...researchTasks.map(mapResearchTaskToViewModel),
      ],
      activity: activityItems.map(mapActivityItemToViewModel),
      recentCompleted,
    })

    // Deduplicate: skip DB tasks whose file name is already in memory
    const inMemoryTitles = new Set(memoryTasks.map((t) => t.title))
    const dbTaskViewModels = dbTasksRaw
      .filter((t) => !inMemoryTitles.has(t.source_file_name))
      .map(dbTaskToViewModel)

    return [...memoryTasks, ...dbTaskViewModels]
  }, [ingestQueue, mergeQueue, researchTasks, activityItems, recentCompleted, dbTasksRaw])

  const filtered = useMemo(
    () => applyTaskFilters(tasks, statusFilter, kindFilter),
    [tasks, statusFilter, kindFilter],
  )

  const selected = useMemo(
    () => filtered.find((t) => t.id === selectedTaskId) ?? filtered[0] ?? null,
    [filtered, selectedTaskId],
  )

  const counts = useMemo(
    () => ({
      running: tasks.filter((t) => t.status === "running").length,
      queued: tasks.filter((t) => t.status === "queued").length,
      failed: tasks.filter((t) => t.status === "failed").length,
      done: tasks.filter((t) => t.status === "done").length,
    }),
    [tasks],
  )

  const STATUS_FILTER_OPTIONS: Array<{ value: "all" | TaskStatus; label: string }> = [
    { value: "all", label: "全部" },
    { value: "running", label: "运行中" },
    { value: "queued", label: "排队中" },
    { value: "failed", label: "失败" },
    { value: "done", label: "完成" },
  ]

  const KIND_FILTER_OPTIONS: Array<{ value: "all" | TaskKind; label: string }> = [
    { value: "all", label: "全部" },
    { value: "ingest", label: "导入" },
    { value: "research", label: "研究" },
    { value: "merge", label: "合并" },
    { value: "maintenance", label: "维护" },
  ]

  return (
    <div className="flex h-full min-h-0">
      {/* ── Left: list ─────────────────────────────────────────────── */}
      <section className="flex min-w-0 flex-1 flex-col border-r">
        <div className="border-b px-4 py-3">
          <h2 className="text-sm font-semibold">任务</h2>
        </div>

        {/* Summary cards */}
        <div className="flex gap-2 border-b px-4 py-3">
          <SummaryCard
            label="运行中" count={counts.running} status="running"
            active={statusFilter === "running"}
            onClick={() => setStatusFilter(statusFilter === "running" ? "all" : "running")}
          />
          <SummaryCard
            label="排队中" count={counts.queued} status="queued"
            active={statusFilter === "queued"}
            onClick={() => setStatusFilter(statusFilter === "queued" ? "all" : "queued")}
          />
          <SummaryCard
            label="失败" count={counts.failed} status="failed"
            active={statusFilter === "failed"}
            onClick={() => setStatusFilter(statusFilter === "failed" ? "all" : "failed")}
          />
          <SummaryCard
            label="完成" count={counts.done} status="done"
            active={statusFilter === "done"}
            onClick={() => setStatusFilter(statusFilter === "done" ? "all" : "done")}
          />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-x-4 gap-y-2 border-b px-4 py-2">
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">状态</span>
            <div className="flex gap-0.5">
              {STATUS_FILTER_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setStatusFilter(value)}
                  className={`rounded px-2 py-0.5 text-xs transition-colors hover:bg-accent ${statusFilter === value ? "bg-accent font-medium" : "text-muted-foreground"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">类型</span>
            <div className="flex gap-0.5">
              {KIND_FILTER_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setKindFilter(value)}
                  className={`rounded px-2 py-0.5 text-xs transition-colors hover:bg-accent ${kindFilter === value ? "bg-accent font-medium" : "text-muted-foreground"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Task list */}
        <ScrollArea className="flex-1">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground">
              <p>暂无任务</p>
            </div>
          ) : (
            <div className="p-2">
              {filtered.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  selected={task.id === selected?.id}
                  onClick={() => setSelectedTaskId(task.id)}
                />
              ))}
            </div>
          )}
        </ScrollArea>

        <div className="border-t px-4 py-2 text-xs text-muted-foreground">
          共 {filtered.length} 个任务{filtered.length !== tasks.length ? `（已过滤 ${tasks.length - filtered.length} 个）` : ""}
        </div>
      </section>

      {/* ── Right: detail ──────────────────────────────────────────── */}
      <aside className="w-[360px] shrink-0 overflow-y-auto">
        {selected ? (
          <TaskDetail task={selected} />
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
            选择一个任务查看详情
          </div>
        )}
      </aside>
    </div>
  )
}
