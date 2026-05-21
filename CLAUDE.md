# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

LLM Wiki is an AI-powered wiki tool that ingests sources (documents, URLs, code) and generates structured wiki pages. It runs as either a Tauri desktop app or a web app backed by an ASP.NET Core API. A companion MCP server exposes the wiki to AI agents (Claude Code, Codex).

## Commands

### Frontend (root)
```bash
npm run dev          # Dev server on port 1420
npm run build        # Type-check + Vite production build → /dist
npm run typecheck    # Run tsc without emitting
npm run test:mocks   # Vitest unit/integration tests (excludes real LLM calls)
npm run test:llm     # Real LLM tests — requires API keys, runs serially
npx vitest run src/lib/search.test.ts   # Run a single test file
```

### Backend (`/llm-wiki-server`)
```bash
dotnet run --project LlmWiki.Api                     # ASP.NET Core on port 5200
dotnet test                                          # Run all xUnit tests
dotnet test --filter "ClassName=IngestWorkerTests"  # Run a single test class

# EF Core migrations (run from llm-wiki-server/src/LlmWiki.Api/)
dotnet ef migrations add <MigrationName>
dotnet ef database update
```

### MCP Server (`/mcp-server`)
```bash
npm run build        # tsc → dist/
npm run test         # vitest
```

### Docker (full stack)
```bash
docker compose up --build   # frontend (nginx:8080) + .NET API (5200) + Qdrant
```

## Architecture

### Three-tier data model
Sources (URLs, files, notes) → **Ingest pipeline** → Wiki pages (Markdown) → **Schema** (typed structured data extracted from pages)

### Operation Modes

The app has two runtime modes controlled by `VITE_DOTNET_BACKEND`:

- **Tauri desktop** (flag unset): Frontend accesses the filesystem directly via Tauri's `invoke` API. No .NET backend needed.
- **Web/cloud** (flag = `1`): All filesystem and project operations route through `/src/commands/fs.ts` → `/src/api/dotnet-client.ts` → .NET API on port 5200. `dotnet-client.ts` provides typed `httpGet/Post/Delete/Put/Patch/Upload` wrappers, handles JWT token storage and automatic 401 refresh, and redirects to `/login` in multi-tenant mode.

Backend mode is a compile-time decision; the same frontend binary cannot switch modes at runtime. `src/commands/fs.ts` is the single entry point for all filesystem operations — don't call `dotnet-client.ts` directly from components.

### Frontend (`/src`)
- **React 19 + Vite + TypeScript + Tailwind CSS v4**
- Path alias: `@/` → `./src/`. `__APP_VERSION__` is injected at build time from `package.json`.
- State: Zustand stores in `/src/stores/` — `wiki-store.ts` (projects/files/pages), `auth-store.ts` (JWT + multi-tenant flag), `org-store.ts` (org/dept), `tasks-store.ts` (ingest queue)
- Business logic in `/src/lib/`:
  - `ingest.ts` (69KB) — orchestrates source ingestion end-to-end; core of the product
  - `ingest-queue.ts` — async queue for ingest tasks
  - `llm-client.ts` — streaming LLM integration with abort support
  - `llm-providers.ts` — multi-provider config (OpenAI, Claude, Ollama, DeepSeek, etc.)
  - `embedding.ts` — vector embeddings; delegates to backend in web mode
  - `search.ts` — hybrid full-text + semantic search
  - `project-store.ts` — persisted per-project configuration
  - `deep-research.ts` — multi-step research pipeline built on ingest
  - `text-chunker.ts` — text chunking for embeddings and context
  - `context-budget.ts` — token budget tracking for LLM context windows
- LLM calls are always streamed; `llm-client.ts` exposes abort signals for cancellation.
- Graph visualization: react-sigma + graphology with Louvain community detection and ForceAtlas2 layout
- Editor: Milkdown (rich markdown editor with remark/rehype plugins including KaTeX math)

### Backend (`/llm-wiki-server`)
ASP.NET Core 8.0 API with PostgreSQL (EF Core, snake_case naming) + Qdrant. Enabled via `VITE_DOTNET_BACKEND=1`.

**DB entities** (all in `AppDbContext`): `AppUser`, `RefreshToken`, `Organization`, `Department`, `DepartmentMember`, `DepartmentModule`, `IngestTask`, `LlmConfig`, `EmbeddingConfig`. Migrations run automatically on startup via `db.Database.Migrate()`.

**Module layout** (`Modules/`):
- `Identity/` — `AuthController` (JWT login/refresh/logout), `JwtService`, `PasswordService`
- `Org/` — `OrgController`, `DeptController`, `DeptMemberController`
- `Wiki/` — `IngestTaskController`, `LlmConfigController`, `EmbeddingConfigController`, `DeptWikiController`, `DeptFileController`, `SseController`, `MigrateController`
- `Admin/` — `AdminController`

**Top-level controllers**: `FileController`, `ProjectController`, `VectorController`, `ExtractController`, `ClaudeController`, `CloudWikiController`, `ProxyController`, `StatusController`

**Infrastructure**:
- `LlmHttpClient` — routes to three providers based on `LlmConfig.Provider`: OpenAI-compat (`StreamOpenAiCompatAsync`), Anthropic (`StreamAnthropicAsync`), Gemini (`StreamGeminiAsync`). Internal methods are `internal` for unit testing.
- `EmbeddingHttpClient` — routes to OpenAI-compat or Google batch embedding API. `RedactQueryKey()` strips `key=` from URLs in exception messages to prevent API key leaks.
- `IngestWorkerService` — `BackgroundService` with a bounded `Channel<byte>` signal. Claims tasks atomically via `UPDATE … WHERE status='queued' … FOR UPDATE SKIP LOCKED … RETURNING *` to support multiple concurrent instances. Each process has a stable `InstanceId`; startup recovery only resets tasks locked by that instance's own ID.
- `IngestEventBroadcaster` / `SseController` — SSE push for ingest progress events to the frontend
- `AppDbContext` — EF Core with Npgsql; all tables use snake_case naming convention

**Config scoping pattern**: Both `LlmConfig` and `EmbeddingConfig` are scoped to exactly one of `UserId` OR `DepartmentId` (enforced by a `CHECK` constraint and a partial unique index per scope). The pipeline reads the active config for the current user/dept before embedding.

**Multi-tenant features** (enabled by `VITE_MULTI_TENANT=true`):
- Organizations and departments (`Modules/Org/`)
- Role-based access via `[RequireDeptRole]` / `[RequireSuperAdmin]` attributes
- `TenantMiddleware` populates `ITenantContext` per request from the JWT

**Health endpoints**: `GET /health`, `GET /api/health/ingest-worker` (returns `workerAlive`, `lastCompletedAt`, `currentTaskId`). WebSocket at `/ws/claude` for Claude CLI integration.

**DataProtection**: Key ring must be persisted to a volume (`DataProtection:KeysPath`, default `/data/keys`); otherwise container rebuilds break decryption of DB-stored keys.

### MCP Server (`/mcp-server`)
Node.js TypeScript MCP server with two modes:
- **`local`**: reads wiki files directly from the filesystem
- **`cloud`**: calls the .NET REST API via HTTP (contract in `mcp-server/CLOUD_API.md`)

Exports three tools to AI agents: `wiki_pages`, `wiki_search`, `wiki_overview`.
CLI args: `--mode local|cloud`, `--base-url <url>`, `--project-id <id>`.

### Vector Search
Qdrant (v1.12.5) for embedding-based semantic search. Only active in Docker/cloud deployment. Connection configured via `Qdrant__Host` / `Qdrant__Port` environment variables. `EmbeddingConfig.Dimensions` must match the Qdrant collection's vector size.

## Environment Setup

**Development** — copy `.env.example`:
```
VITE_DOTNET_BACKEND=1                    # Enable .NET backend (omit for Tauri mode)
VITE_DOTNET_URL=http://localhost:5200    # Backend URL
VITE_DEEPSEEK_API_KEY=                  # Optional provider key
```

**Docker deployment** — copy `.env.deploy.example`:
```
WEB_PORT=8080
PUBLIC_ORIGIN=https://wiki.example.com
LLM_WIKI_API_KEY=<bearer token for MCP cloud API>
WIKI_ROOT_PATH=/srv/wiki                 # Host path for wiki files
VITE_MULTI_TENANT=true                   # Enable login + org/dept features
POSTGRES_PASSWORD=<required>
JWT_SECRET=<required, 32+ chars>
INITIAL_ADMIN_EMAIL/PASSWORD/NAME        # Auto-created on first run
```

Backend also reads: `Cors__Origins__0`, `ConnectionStrings__Default`, `Jwt__Issuer`, `Jwt__Audience`.

## Testing Strategy

### Frontend
- `*.test.ts` — unit/integration tests, run with `test:mocks`
- `*.property.test.ts` — property-based tests using `fast-check`
- `*.real-llm.test.ts` — require live API keys; run with `test:llm` (no parallelism)
- `*.integration.test.ts` / `*.scenarios.test.ts` — included in `test:mocks`

Real LLM test keys are loaded from `.env.test.local` via `src/test-helpers/load-test-env.ts`.

### Backend
xUnit tests in `llm-wiki-server/tests/LlmWiki.Api.Tests/`. Integration tests use `TestWebApplicationFactory` with SQLite/in-memory EF Core. `internal` methods on `LlmHttpClient` and `EmbeddingHttpClient` are tested directly (same assembly via `InternalsVisibleTo`).
