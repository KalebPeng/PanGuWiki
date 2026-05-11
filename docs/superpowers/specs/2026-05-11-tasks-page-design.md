# Tasks Page Design

## Goal

Add a first-class `Tasks` page that unifies background work visibility across the app. The first release is a monitoring center with a small set of high-value actions. It does not replace the existing bottom-left activity strip; it complements it with a full-page view.

The page must unify these task families:

- Ingest queue
- Deep research tasks
- Dedup merge queue
- Maintenance/background activity such as lint and review sweep

## Why

The current bottom-left queue/activity surface is useful for lightweight status, but it is too constrained for:

- understanding what is running now
- seeing what is queued next
- inspecting failures and partial progress
- reviewing recent task outcomes in one place

The app already has multiple task systems with partially overlapping UI patterns. The `Tasks` page should give the user one place to monitor them without forcing an immediate backend or storage redesign.

## Non-Goals

- No new database for task storage
- No attempt to make all task engines share identical runtime internals in v1
- No batch task management in v1
- No persistent full event log for every activity in v1
- No removal of the current bottom activity panel

## Product Scope

### V1 outcome

`Tasks` becomes a new top-level app view, peer to `Sources`, `Search`, and `Review`.

It provides:

- global counts for running, queued, failed, and recently completed tasks
- one unified task list across all supported task families
- task status filtering
- task type filtering
- a detail panel for the selected task
- task-specific actions where they already exist: cancel, retry, open related file/page

### V1 storage policy

Use the existing mixed storage model:

- queue-backed tasks continue using project-level persisted JSON under `.llm-wiki/`
- non-queue activity detail remains session-level in frontend memory
- the page keeps only the most recent 10 completed tasks in its unified view model

This matches the requested compromise:

- persistent queue state where it already exists
- no new database
- no promise that every detailed step survives restart

## Current State

The repository already has multiple task sources:

- `src/lib/ingest-queue.ts`: persisted ingest queue with pending/processing/failed state
- `src/lib/dedup-queue.ts`: persisted dedup merge queue
- `src/stores/research-store.ts`: deep research runtime tasks
- `src/stores/activity-store.ts`: generic in-memory activity items for ingest, lint, query-like work
- `src/components/layout/activity-panel.tsx`: compact bottom panel that mixes queue state and activity state

The key limitation is not lack of data. It is lack of a unified read model and full-page UI.

## Design Approach

### Recommended approach

Build a UI-layer task aggregation model first, without rewriting the existing task engines.

This means introducing a normalized `TaskViewModel` that maps each existing source into a shared display shape. The UI reads from this model; underlying systems keep their own storage and execution logic.

This is the right first step because:

- it delivers the page quickly
- it avoids risky refactors in ingest/research/dedup logic
- it leaves room for a future unified task registry if the product needs deeper task management later

## Information Architecture

### Navigation

Add `Tasks` as a new primary navigation item in the left icon sidebar.

### Page layout

The page has three sections:

1. Summary header
2. Unified task list
3. Task detail pane

#### Summary header

Shows:

- Running
- Queued
- Failed
- Recent Completed

Also shows per-type counts:

- Ingest
- Research
- Merge
- Maintenance

#### Unified task list

Default sort order:

1. Running
2. Queued
3. Failed
4. Recently completed

V1 filters:

- status: `All`, `Running`, `Queued`, `Failed`, `Recent Completed`
- type: `All Types`, `Ingest`, `Research`, `Merge`, `Maintenance`

Each list row should show:

- title
- task type
- current status
- short detail text
- creation/start time
- lightweight progress hint when available

#### Task detail pane

Shows:

- source task family
- current status
- created/start timestamp
- latest detail/status text
- error text when present
- files written or touched
- related page/file links
- stage timeline when available
- allowed actions

## Data Model

Introduce a UI-only normalized shape, for example:

```ts
type TaskKind = "ingest" | "research" | "merge" | "maintenance"
type TaskStatus = "running" | "queued" | "failed" | "done"

interface TaskViewModel {
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
```

Notes:

- This is a presentation model, not a storage contract.
- `rawRef` can point back to the underlying task id for action dispatch.
- `filesWritten` and `relatedPaths` allow the detail pane to navigate into the wiki.

## Source Mapping

### Ingest

Primary source:

- `ingest-queue.ts`
- matching `activity-store` entries when available

Mapping rules:

- `processing` -> `running`
- `pending` -> `queued`
- `failed` -> `failed`
- recent successful ingest should be derived from the matching activity item when the queue task disappears after success

### Merge

Primary source:

- `dedup-queue.ts`

Mapping rules parallel ingest:

- `processing` -> `running`
- `pending` -> `queued`
- `failed` -> `failed`
- recent success should be retained in the page's recent-completed buffer

### Research

Primary source:

- `research-store.ts`

Mapping rules:

- `queued` -> `queued`
- `searching`, `synthesizing`, `saving` -> `running`
- `done` -> `done`
- `error` -> `failed`

### Maintenance

Primary source:

- `activity-store.ts`

Initial families included:

- lint
- review sweep
- other generic non-queue activity items not already claimed by ingest

Because `activity-store` is currently coarse, maintenance detail in v1 will be best-effort rather than fully structured.

## Recent Completed Policy

Keep only the most recent 10 completed unified tasks in the page model.

Rules:

- queue-backed successful tasks can enter the buffer when they transition out of the queue
- activity-backed successful tasks can enter the buffer when their status becomes `done`
- this buffer is session-level in v1

This keeps the UI useful without promising durable historical audit data.

## Actions

V1 actions are intentionally limited.

Supported:

- cancel running ingest task
- cancel queued ingest task
- retry failed ingest task
- cancel running/queued merge task if already supported by queue API
- retry failed merge task if already supported by queue API
- open written file
- open related page

Deferred:

- bulk cancel
- bulk retry
- archive/clear task history from the `Tasks` page
- edit queue priority

## Detailed Execution View

The user requested detailed execution visibility. V1 should provide this by combining:

- current detail text from underlying stores
- queue state
- progress labels when exposed by the task engine
- a stage timeline assembled from known state transitions

The stage timeline is approximate in v1:

- for ingest, use known detail transitions such as image extraction, captioning, analyzing, generating, writing, embedding
- for research, use existing status stages
- for merge/maintenance, show the coarse stages already available

This is enough to make the page meaningfully more informative than the current compact panel without first instrumenting a durable event stream.

## UX Relationship With Existing Activity Panel

Keep the bottom activity panel as a compact live summary.

Changes:

- add a clear affordance to open `Tasks`
- reduce pressure on the panel to be the only place where detailed state is visible

The compact panel remains useful for glanceable awareness while the full page becomes the inspection surface.

## Implementation Outline

1. Add `tasks` to `WikiState["activeView"]` and navigation.
2. Add a new `TasksView` to `content-area.tsx`.
3. Introduce a small aggregation layer that reads queue/store sources and emits `TaskViewModel[]`.
4. Add recent-completed buffering for the last 10 tasks at the UI/store layer.
5. Build the page:
   - summary cards
   - filters
   - list
   - detail pane
6. Hook existing task actions into the detail/list UI.
7. Optionally add an "Open Tasks" shortcut from the bottom activity panel.

## Risks

### Duplicate representation

The same underlying ingest can appear both in queue state and activity state. The aggregation layer must de-duplicate these views carefully.

### Uneven detail quality

Different task families expose different levels of runtime detail. V1 should normalize what exists, not fake precision.

### Recent-completed transition detection

Queue tasks disappear on success, so the aggregator needs explicit transition tracking to preserve a recent completed row.

## Testing Strategy

Add focused tests around the aggregation layer:

- merges queue/store inputs into one list
- de-duplicates matching ingest queue + activity entries
- preserves the most recent 10 completed tasks only
- maps source-specific statuses correctly
- exposes the correct actions per task type/status

UI tests should verify:

- `Tasks` nav appears and switches view
- filters change visible rows
- selecting a task updates the detail panel
- file navigation actions call the expected handlers

## Future Evolution

If the page proves valuable, the next step is not "add a database immediately." The next step is to consider a unified task registry with richer event emission. That future system could still persist to project files first and only move to a database if product needs actually demand it.
