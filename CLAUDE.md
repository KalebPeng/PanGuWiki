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
npm run test         # Run all tests (mocks + LLM)
npm run test:mocks   # Vitest unit/integration tests (excludes real LLM calls)
npm run test:llm     # Real LLM tests — requires API keys, runs serially
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

### Backend (`/llm-wiki-server`)
```bash
dotnet run --project LlmWiki.Api   # ASP.NET Core on port 5200
```

## Architecture

### Three-tier data model
Sources (URLs, files, notes) → **Ingest pipeline** → Wiki pages (Markdown) → **Schema** (typed structured data extracted from pages)

### Frontend (`/src`)
- **React 19 + Vite + TypeScript + Tailwind CSS v4**
- State: Zustand stores in `/src/stores/` (`wiki-store.ts` is central — projects, files, pages, settings)
- Business logic lives in `/src/lib/` (~150 files). The most important files:
  - `ingest.ts` (69KB) — orchestrates source ingestion end-to-end
  - `ingest-queue.ts` — async queue for ingest tasks
  - `llm-client.ts` — streaming LLM integration with abort support
  - `llm-providers.ts` — multi-provider config (OpenAI, Claude, Ollama, DeepSeek, etc.)
  - `embedding.ts` — vector embeddings for semantic search
  - `search.ts` — hybrid full-text + semantic search
  - `project-store.ts` — persisted per-project configuration
- UI components in `/src/components/` grouped by feature (chat, editor, graph, layout, lint, review, search, settings, sources)
- Graph visualization: react-sigma + graphology with Louvain community detection and ForceAtlas2 layout
- Editor: Milkdown (rich markdown editor with remark/rehype plugins including KaTeX math)
- i18n: i18next

### Backend (`/llm-wiki-server`)
ASP.NET Core 8.0 API. Enabled via `VITE_DOTNET_BACKEND=1`. Handles file I/O and heavier operations when running in web/cloud mode (as opposed to Tauri desktop mode where the frontend talks directly to the filesystem).

### MCP Server (`/mcp-server`)
Node.js TypeScript MCP server with two modes:
- **`local`**: reads wiki files directly from the filesystem
- **`cloud`**: calls the .NET REST API via HTTP (see `CLOUD_API.md` for the contract)

Exports three tools to AI agents: `wiki_pages`, `wiki_search`, `wiki_overview`.

### Vector Search
Qdrant (v1.12.5) for embedding-based semantic search. Only active in Docker/cloud deployment.

## Environment Setup

Copy `.env.example` and configure:
```
VITE_DOTNET_BACKEND=1                    # Enable .NET backend (omit for Tauri mode)
VITE_DOTNET_URL=http://localhost:5200    # Backend URL
VITE_DEEPSEEK_API_KEY=                  # Optional provider key
```

For Docker deployment, see `.env.deploy` — additional vars include `WEB_PORT`, `PUBLIC_ORIGIN`, `LLM_WIKI_API_KEY`, `WIKI_ROOT_PATH`.

## Testing Strategy

- `*.test.ts` — standard unit/integration tests, run with `test:mocks`
- `*.property.test.ts` — property-based tests using `fast-check`
- `*.real-llm.test.ts` — require live API keys; run with `test:llm` (no parallelism)
- `*.integration.test.ts` — integration tests included in `test:mocks`
- `*.scenarios.test.ts` — scenario-based tests included in `test:mocks`

Run a single test file: `npx vitest run src/lib/search.test.ts`

## Key Patterns

- The ingest pipeline (`ingest.ts`) is the core of the product — changes here affect how all sources become wiki pages.
- LLM calls are always streamed; `llm-client.ts` exposes abort signals for cancellation.
- Zustand stores are the source of truth for UI state; avoid prop-drilling.
- The app works in two modes: **Tauri desktop** (direct filesystem access) and **web** (via .NET API). The `VITE_DOTNET_BACKEND` flag toggles this; code in `/src/api/` wraps the backend calls.
