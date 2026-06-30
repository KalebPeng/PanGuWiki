# Single Project MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone MCP server that lets Codex search and read one configured LLM Wiki project.

**Architecture:** Add a focused Node/TypeScript package in `mcp-server/`. Core wiki indexing and resolution logic lives in testable modules, while `src/index.ts` only handles MCP stdio wiring and CLI argument parsing.

**Tech Stack:** Node.js, TypeScript, Vitest, `@modelcontextprotocol/sdk`.

---

### Task 1: MCP Package Skeleton

**Files:**
- Create: `mcp-server/package.json`
- Create: `mcp-server/tsconfig.json`

- [ ] Create an isolated package with build and test scripts.

- [ ] Add `@modelcontextprotocol/sdk` as a runtime dependency and Vitest/TypeScript as dev dependencies.

### Task 2: Wiki Reader Core

**Files:**
- Create: `mcp-server/src/wiki.ts`
- Create: `mcp-server/src/wiki.test.ts`

- [ ] Write failing tests for listing pages, Chinese search, title/path page resolution, overview aggregation, and path traversal rejection.

- [ ] Run `npm test` in `mcp-server/` and confirm the tests fail because `wiki.ts` is missing.

- [ ] Implement `createWikiService(projectPath)` with `listPages`, `search`, `readPage`, and `getOverview`.

- [ ] Run `npm test` in `mcp-server/` and confirm the tests pass.

### Task 3: MCP Stdio Server

**Files:**
- Create: `mcp-server/src/index.ts`

- [ ] Add CLI parsing for `--project <path>`.

- [ ] Register MCP tools: `search_wiki`, `read_wiki_page`, `list_wiki_pages`, `get_wiki_overview`.

- [ ] Make each tool call the tested wiki service and return JSON text content.

### Task 4: Documentation And Verification

**Files:**
- Modify: `README_CN.md`

- [ ] Document the Codex MCP configuration snippet.

- [ ] Run `npm install` in `mcp-server/`.

- [ ] Run `npm test` in `mcp-server/`.

- [ ] Run `npm run build` in `mcp-server/`.
