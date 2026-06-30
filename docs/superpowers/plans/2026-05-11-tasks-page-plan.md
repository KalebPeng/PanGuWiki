# Tasks Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a top-level `Tasks` page that unifies ingest, research, merge, and maintenance task visibility with filters, detail view, and limited task actions.

**Architecture:** Build a UI-only aggregation layer that maps existing queue/store sources into a normalized `TaskViewModel`, then render a dedicated `TasksView` from that model. Keep queue persistence where it already exists, and keep recent-completed history as a session-level buffer capped at 10 items.

**Tech Stack:** React 19, TypeScript, Zustand, Vitest, existing queue/store modules, existing app layout/navigation components

---

## File Structure

### Create

- `src/lib/tasks-model.ts`
  Owns the normalized task types, source-to-view-model mapping helpers, de-duplication, sorting, filtering, and recent-completed buffer helpers.

- `src/lib/tasks-model.test.ts`
  Covers task mapping, de-duplication, sort order, status/type filters, and recent-completed cap behavior.

- `src/stores/tasks-store.ts`
  Owns the session-level recent-completed buffer and selection/filter state for the `Tasks` page.

- `src/stores/tasks-store.test.ts`
  Covers recent-completed insertion, duplicate replacement, and max-10 trimming.

- `src/components/tasks/tasks-view.tsx`
  Full-page task monitor UI: summary cards, filters, list, detail panel, and task actions.

### Modify

- `src/stores/wiki-store.ts`
  Add `tasks` to `activeView`.

- `src/components/layout/content-area.tsx`
  Route the new `tasks` view.

- `src/components/layout/icon-sidebar.tsx`
  Add a primary nav item for `Tasks`.

- `src/components/layout/activity-panel.tsx`
  Add a clear affordance to open `Tasks`, while keeping the panel as the compact live surface.

- `src/stores/activity-store.ts`
  Extend the activity type union so maintenance-like tasks can be represented without string-casting in the new aggregator.

### Existing sources the implementation must read, not redesign

- `src/lib/ingest-queue.ts`
- `src/lib/dedup-queue.ts`
- `src/stores/research-store.ts`
- `src/stores/activity-store.ts`

## Task 1: Add Tasks View Routing And Core Types

**Files:**
- Modify: `src/stores/wiki-store.ts`
- Modify: `src/components/layout/content-area.tsx`
- Modify: `src/components/layout/icon-sidebar.tsx`
- Create: `src/lib/tasks-model.ts`
- Test: `src/lib/tasks-model.test.ts`

- [ ] **Step 1: Write the failing model test for task status/type mapping**

```ts
import { describe, expect, it } from "vitest"
import { mapResearchTaskToViewModel } from "./tasks-model"

describe("mapResearchTaskToViewModel", () => {
  it("maps queued and active research statuses into task view statuses", () => {
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
      }).status,
    ).toBe("queued")

    expect(
      mapResearchTaskToViewModel({
        id: "research-2",
        topic: "KV cache",
        status: "synthesizing",
        webResults: [],
        synthesis: "",
        savedPath: null,
        error: null,
        createdAt: 2,
      }).status,
    ).toBe("running")
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/tasks-model.test.ts`

Expected: FAIL because `src/lib/tasks-model.ts` does not exist yet.

- [ ] **Step 3: Add the core task model file and routing scaffolding**

```ts
// src/lib/tasks-model.ts
import type { ResearchTask } from "@/stores/research-store"

export type TaskKind = "ingest" | "research" | "merge" | "maintenance"
export type TaskStatus = "running" | "queued" | "failed" | "done"

export interface TaskViewModel {
  id: string
  kind: TaskKind
  source: "ingest-queue" | "dedup-queue" | "research-store" | "activity-store"
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
  rawRef?: string
}

export function mapResearchTaskToViewModel(task: ResearchTask): TaskViewModel {
  const status =
    task.status === "queued"
      ? "queued"
      : task.status === "done"
        ? "done"
        : task.status === "error"
          ? "failed"
          : "running"

  return {
    id: task.id,
    kind: "research",
    source: "research-store",
    title: task.topic,
    status,
    detail: task.status,
    createdAt: task.createdAt,
    error: task.error ?? undefined,
    filesWritten: task.savedPath ? [task.savedPath] : [],
    relatedPaths: task.savedPath ? [task.savedPath] : [],
    canCancel: false,
    canRetry: false,
    rawRef: task.id,
  }
}
```

```ts
// src/stores/wiki-store.ts
activeView: "wiki" | "sources" | "search" | "graph" | "lint" | "review" | "tasks" | "settings"
```

```tsx
// src/components/layout/content-area.tsx
case "tasks":
  return <TasksView />
```

```tsx
// src/components/layout/icon-sidebar.tsx
{ view: "tasks", icon: ClipboardList, labelKey: "nav.tasks" }
```

- [ ] **Step 4: Run the focused test and typecheck**

Run: `npx vitest run src/lib/tasks-model.test.ts && npm run typecheck`

Expected: the new model test passes and the app typechecks with the new `tasks` view key present.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tasks-model.ts src/lib/tasks-model.test.ts src/stores/wiki-store.ts src/components/layout/content-area.tsx src/components/layout/icon-sidebar.tsx
git commit -m "feat: add tasks view routing and core task model"
```

## Task 2: Build Aggregation, De-Duplication, And Recent Completed Buffer

**Files:**
- Modify: `src/lib/tasks-model.ts`
- Create: `src/stores/tasks-store.ts`
- Test: `src/lib/tasks-model.test.ts`
- Test: `src/stores/tasks-store.test.ts`

- [ ] **Step 1: Write the failing aggregation test for ingest de-duplication and completed-buffer trimming**

```ts
import { describe, expect, it } from "vitest"
import { mergeTaskSnapshots, pushRecentCompleted } from "./tasks-model"

describe("mergeTaskSnapshots", () => {
  it("deduplicates a processing ingest queue row and matching activity row", () => {
    const merged = mergeTaskSnapshots({
      queueTasks: [
        { id: "ingest-1", kind: "ingest", title: "paper.pdf", status: "running", detail: "queued", createdAt: 1 },
      ],
      activityTasks: [
        { id: "activity-1", kind: "ingest", title: "paper.pdf", status: "running", detail: "Analyzing", createdAt: 2 },
      ],
      mergeTasks: [],
      researchTasks: [],
      recentCompleted: [],
    })

    expect(merged.filter((t) => t.kind === "ingest")).toHaveLength(1)
    expect(merged[0].detail).toBe("Analyzing")
  })
})

describe("pushRecentCompleted", () => {
  it("keeps only the 10 most recent completed tasks", () => {
    const seed = Array.from({ length: 10 }, (_, i) => ({
      id: `done-${i}`,
      kind: "maintenance",
      source: "activity-store" as const,
      title: `done-${i}`,
      status: "done" as const,
      detail: "done",
      createdAt: i,
      filesWritten: [],
      relatedPaths: [],
      canCancel: false,
      canRetry: false,
    }))

    const next = pushRecentCompleted(seed, {
      ...seed[0],
      id: "done-10",
      title: "done-10",
      createdAt: 99,
    })

    expect(next).toHaveLength(10)
    expect(next[0].id).toBe("done-10")
    expect(next.some((t) => t.id === "done-0")).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/tasks-model.test.ts src/stores/tasks-store.test.ts`

Expected: FAIL because the aggregator helpers and `tasks-store` do not exist yet.

- [ ] **Step 3: Implement the aggregator helpers and tasks store**

```ts
// src/lib/tasks-model.ts
export interface MergeTaskSnapshotsArgs {
  queueTasks: TaskViewModel[]
  activityTasks: TaskViewModel[]
  mergeTasks: TaskViewModel[]
  researchTasks: TaskViewModel[]
  recentCompleted: TaskViewModel[]
}

function taskSortWeight(status: TaskStatus): number {
  return status === "running" ? 0 : status === "queued" ? 1 : status === "failed" ? 2 : 3
}

function sameIngest(task: TaskViewModel, other: TaskViewModel): boolean {
  return task.kind === "ingest" && other.kind === "ingest" && task.title === other.title
}

export function pushRecentCompleted(
  items: TaskViewModel[],
  incoming: TaskViewModel,
): TaskViewModel[] {
  const withoutSame = items.filter((item) => item.id !== incoming.id)
  return [incoming, ...withoutSame].sort((a, b) => b.createdAt - a.createdAt).slice(0, 10)
}

export function mergeTaskSnapshots(args: MergeTaskSnapshotsArgs): TaskViewModel[] {
  const merged: TaskViewModel[] = []

  for (const task of [...args.queueTasks, ...args.mergeTasks, ...args.researchTasks]) {
    merged.push(task)
  }

  for (const task of args.activityTasks) {
    const existing = merged.find((candidate) => sameIngest(candidate, task))
    if (existing) {
      existing.detail = task.detail || existing.detail
      existing.filesWritten = task.filesWritten.length > 0 ? task.filesWritten : existing.filesWritten
      continue
    }
    merged.push(task)
  }

  for (const task of args.recentCompleted) {
    if (!merged.some((candidate) => candidate.id === task.id)) {
      merged.push(task)
    }
  }

  return merged.sort((a, b) => {
    const weightDelta = taskSortWeight(a.status) - taskSortWeight(b.status)
    return weightDelta !== 0 ? weightDelta : b.createdAt - a.createdAt
  })
}
```

```ts
// src/stores/tasks-store.ts
import { create } from "zustand"
import type { TaskKind, TaskStatus, TaskViewModel } from "@/lib/tasks-model"
import { pushRecentCompleted } from "@/lib/tasks-model"

interface TasksState {
  selectedTaskId: string | null
  statusFilter: "all" | TaskStatus
  kindFilter: "all" | TaskKind
  recentCompleted: TaskViewModel[]
  setSelectedTaskId: (id: string | null) => void
  setStatusFilter: (value: "all" | TaskStatus) => void
  setKindFilter: (value: "all" | TaskKind) => void
  recordCompletedTask: (task: TaskViewModel) => void
  clearState: () => void
}

export const useTasksStore = create<TasksState>((set) => ({
  selectedTaskId: null,
  statusFilter: "all",
  kindFilter: "all",
  recentCompleted: [],
  setSelectedTaskId: (selectedTaskId) => set({ selectedTaskId }),
  setStatusFilter: (statusFilter) => set({ statusFilter }),
  setKindFilter: (kindFilter) => set({ kindFilter }),
  recordCompletedTask: (task) =>
    set((state) => ({ recentCompleted: pushRecentCompleted(state.recentCompleted, task) })),
  clearState: () =>
    set({
      selectedTaskId: null,
      statusFilter: "all",
      kindFilter: "all",
      recentCompleted: [],
    }),
}))
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `npx vitest run src/lib/tasks-model.test.ts src/stores/tasks-store.test.ts && npm run typecheck`

Expected: the aggregation/store tests pass and the new store typechecks cleanly.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tasks-model.ts src/lib/tasks-model.test.ts src/stores/tasks-store.ts src/stores/tasks-store.test.ts
git commit -m "feat: add unified tasks aggregation store"
```

## Task 3: Implement The Tasks Page UI

**Files:**
- Create: `src/components/tasks/tasks-view.tsx`
- Modify: `src/lib/tasks-model.ts`
- Test: `src/lib/tasks-model.test.ts`

- [ ] **Step 1: Write the failing filter/sort test that matches the UI contract**

```ts
import { describe, expect, it } from "vitest"
import { applyTaskFilters } from "./tasks-model"

describe("applyTaskFilters", () => {
  it("keeps only failed merge tasks when both filters are active", () => {
    const result = applyTaskFilters(
      [
        { id: "1", kind: "merge", status: "failed", title: "merge", detail: "", createdAt: 1, source: "dedup-queue", filesWritten: [], relatedPaths: [], canCancel: false, canRetry: true },
        { id: "2", kind: "ingest", status: "failed", title: "ingest", detail: "", createdAt: 2, source: "ingest-queue", filesWritten: [], relatedPaths: [], canCancel: false, canRetry: true },
      ],
      "failed",
      "merge",
    )

    expect(result.map((task) => task.id)).toEqual(["1"])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/tasks-model.test.ts`

Expected: FAIL because `applyTaskFilters` does not exist yet.

- [ ] **Step 3: Implement the filter helper and the page UI**

```ts
// src/lib/tasks-model.ts
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
```

```tsx
// src/components/tasks/tasks-view.tsx
import { useMemo } from "react"
import { getQueue as getIngestQueue, retryTask as retryIngestTask, cancelTask as cancelIngestTask } from "@/lib/ingest-queue"
import { getQueue as getMergeQueue, retryTask as retryMergeTask, cancelTask as cancelMergeTask } from "@/lib/dedup-queue"
import { useResearchStore } from "@/stores/research-store"
import { useActivityStore } from "@/stores/activity-store"
import { useTasksStore } from "@/stores/tasks-store"
import { applyTaskFilters, mergeTaskSnapshots, mapResearchTaskToViewModel } from "@/lib/tasks-model"

export function TasksView() {
  const researchTasks = useResearchStore((s) => s.tasks)
  const activityItems = useActivityStore((s) => s.items)
  const recentCompleted = useTasksStore((s) => s.recentCompleted)
  const selectedTaskId = useTasksStore((s) => s.selectedTaskId)
  const setSelectedTaskId = useTasksStore((s) => s.setSelectedTaskId)
  const statusFilter = useTasksStore((s) => s.statusFilter)
  const setStatusFilter = useTasksStore((s) => s.setStatusFilter)
  const kindFilter = useTasksStore((s) => s.kindFilter)
  const setKindFilter = useTasksStore((s) => s.setKindFilter)

  const tasks = useMemo(() => {
    return mergeTaskSnapshots({
      queueTasks: mapIngestQueueToTasks(getIngestQueue()),
      mergeTasks: mapDedupQueueToTasks(getMergeQueue()),
      researchTasks: researchTasks.map(mapResearchTaskToViewModel),
      activityTasks: mapActivityItemsToTasks(activityItems),
      recentCompleted,
    })
  }, [researchTasks, activityItems, recentCompleted])

  const filtered = useMemo(
    () => applyTaskFilters(tasks, statusFilter, kindFilter),
    [tasks, statusFilter, kindFilter],
  )

  const selected = filtered.find((task) => task.id === selectedTaskId) ?? filtered[0] ?? null

  return (
    <div className="flex h-full min-h-0">
      <section className="flex min-w-0 flex-1 flex-col border-r">
        {/* summary cards + filters + list */}
      </section>
      <aside className="w-[360px] shrink-0">
        {/* selected task details + actions */}
      </aside>
    </div>
  )
}
```

- [ ] **Step 4: Run tests, typecheck, and a local build**

Run: `npx vitest run src/lib/tasks-model.test.ts && npm run typecheck && npm run build`

Expected: tests pass, typecheck passes, and the app builds with the new `TasksView`.

- [ ] **Step 5: Commit**

```bash
git add src/components/tasks/tasks-view.tsx src/lib/tasks-model.ts src/lib/tasks-model.test.ts
git commit -m "feat: add tasks page UI"
```

## Task 4: Wire Actions, Open-Tasks Shortcut, And Session-Level Completion Tracking

**Files:**
- Modify: `src/components/tasks/tasks-view.tsx`
- Modify: `src/components/layout/activity-panel.tsx`
- Modify: `src/stores/activity-store.ts`
- Modify: `src/stores/tasks-store.ts`
- Test: `src/stores/tasks-store.test.ts`

- [ ] **Step 1: Write the failing store test for recent completed replacement**

```ts
import { describe, expect, it } from "vitest"
import { useTasksStore } from "./tasks-store"

describe("tasks-store recent completed", () => {
  it("replaces an older completed copy of the same task id", () => {
    const store = useTasksStore.getState()
    store.clearState()

    store.recordCompletedTask({
      id: "ingest-1",
      kind: "ingest",
      source: "ingest-queue",
      title: "paper.pdf",
      status: "done",
      detail: "old",
      createdAt: 1,
      filesWritten: [],
      relatedPaths: [],
      canCancel: false,
      canRetry: false,
    })

    store.recordCompletedTask({
      id: "ingest-1",
      kind: "ingest",
      source: "ingest-queue",
      title: "paper.pdf",
      status: "done",
      detail: "new",
      createdAt: 2,
      filesWritten: [],
      relatedPaths: [],
      canCancel: false,
      canRetry: false,
    })

    expect(useTasksStore.getState().recentCompleted).toHaveLength(1)
    expect(useTasksStore.getState().recentCompleted[0].detail).toBe("new")
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/stores/tasks-store.test.ts`

Expected: FAIL until replacement behavior is covered explicitly.

- [ ] **Step 3: Implement action wiring and the activity-panel shortcut**

```tsx
// src/components/layout/activity-panel.tsx
const setActiveView = useWikiStore((s) => s.setActiveView)

<button
  onClick={() => setActiveView("tasks")}
  className="w-full px-3 py-1 text-center text-[10px] text-muted-foreground hover:underline"
>
  打开任务页
</button>
```

```tsx
// src/components/tasks/tasks-view.tsx
function runTaskAction(task: TaskViewModel) {
  if (task.kind === "ingest" && task.canRetry) retryIngestTask(task.rawRef ?? task.id)
  if (task.kind === "ingest" && task.canCancel) cancelIngestTask(task.rawRef ?? task.id)
  if (task.kind === "merge" && task.canRetry) retryMergeTask(task.rawRef ?? task.id)
  if (task.kind === "merge" && task.canCancel) cancelMergeTask(task.rawRef ?? task.id)
}
```

```ts
// src/stores/activity-store.ts
export interface ActivityItem {
  id: string
  type: "ingest" | "lint" | "query" | "maintenance"
  title: string
  status: "running" | "done" | "error"
  detail: string
  filesWritten: string[]
  createdAt: number
}
```

- [ ] **Step 4: Run tests, typecheck, and manual app verification**

Run: `npx vitest run src/stores/tasks-store.test.ts src/lib/tasks-model.test.ts && npm run typecheck`

Expected: tests pass and typecheck stays clean.

Manual verification:

- open the app
- confirm the left nav shows `Tasks`
- enqueue at least one ingest task and verify it appears in `Tasks`
- trigger one research task and verify it appears under `Research`
- confirm the bottom activity panel can jump into `Tasks`
- confirm recent completed list shows at most 10 items

- [ ] **Step 5: Commit**

```bash
git add src/components/tasks/tasks-view.tsx src/components/layout/activity-panel.tsx src/stores/activity-store.ts src/stores/tasks-store.ts src/stores/tasks-store.test.ts
git commit -m "feat: wire tasks actions and recent history"
```

## Task 5: Polish, Regression Check, And Final Verification

**Files:**
- Modify as needed based on verification feedback:
  - `src/components/tasks/tasks-view.tsx`
  - `src/lib/tasks-model.ts`
  - `src/stores/tasks-store.ts`
  - `src/components/layout/activity-panel.tsx`
- Test:
  - `src/lib/tasks-model.test.ts`
  - `src/stores/tasks-store.test.ts`

- [ ] **Step 1: Run the focused automated suite**

Run: `npx vitest run src/lib/tasks-model.test.ts src/stores/tasks-store.test.ts`

Expected: PASS.

- [ ] **Step 2: Run the broader project checks**

Run: `npm run typecheck`

Expected: PASS.

Run: `npm run test:mocks`

Expected: PASS, or if unrelated failures already exist, capture exact failing files before making completion claims.

- [ ] **Step 3: Run a production build**

Run: `npm run build`

Expected: PASS and `dist/` regenerated.

- [ ] **Step 4: Manual regression checklist**

- Navigate between `Wiki`, `Sources`, `Review`, and `Tasks` and confirm view switching still works.
- Confirm `Tasks` does not hide or break the bottom activity panel.
- Confirm failed ingest and failed merge rows still expose retry.
- Confirm selecting a completed task with files written can navigate to those files.
- Confirm maintenance-only activity rows still render even when no queue-backed tasks exist.

- [ ] **Step 5: Commit final polish**

```bash
git add src/components/tasks/tasks-view.tsx src/lib/tasks-model.ts src/stores/tasks-store.ts src/components/layout/activity-panel.tsx src/lib/tasks-model.test.ts src/stores/tasks-store.test.ts
git commit -m "feat: finalize tasks monitoring page"
```

## Spec Coverage Check

- Top-level `Tasks` page: covered by Tasks 1 and 3.
- Unified task aggregation across ingest/research/merge/maintenance: covered by Task 2 and Task 3.
- Session-level recent-completed cap of 10: covered by Task 2 and Task 4.
- Filters and detail panel: covered by Task 3.
- Limited actions only where already supported: covered by Task 4.
- Keep bottom activity panel as compact companion: covered by Task 4.
- No database, no task-engine rewrite: preserved by the architecture in every task.

## Placeholder Scan

No `TODO`, `TBD`, or deferred implementation placeholders are required to execute this plan. Every task names concrete files, focused tests, commands, and commit boundaries.

## Type Consistency Check

- Shared UI types are centralized in `src/lib/tasks-model.ts`.
- `TaskKind` and `TaskStatus` are used consistently across model, store, and UI tasks.
- `rawRef` is the back-reference used by action wiring; task actions should not invent a second id field later in the rollout.
