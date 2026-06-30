# Single Project MCP Design

## Goal

Expose an LLM Wiki project as a local MCP server so Codex can search and read the generated `wiki/` knowledge base outside the app's built-in chat UI.

## Scope

The first version binds to one explicit project path supplied at server startup. It does not track the currently opened frontend project, manage multiple projects, or require the .NET backend to be running.

## Architecture

The MCP server is an independent Node process under `mcp-server/`. It reads Markdown files directly from `<projectPath>/wiki` and exposes a small tool surface over MCP stdio.

The server rejects filesystem access outside the configured project root. Tool inputs may use wiki-relative paths, absolute paths inside the project, bare filenames, or page titles where applicable.

## Tools

`search_wiki`

- Input: `query: string`, optional `limit: number`.
- Output: matched wiki pages with `title`, `path`, `snippet`, and `score`.
- Behavior: keyword search over Markdown pages under `wiki/`, with title and filename matches weighted above body matches.

`read_wiki_page`

- Input: `path_or_title: string`.
- Output: page metadata and full Markdown content.
- Behavior: resolves an exact path first, then filename, then extracted title.

`list_wiki_pages`

- Input: none.
- Output: all Markdown pages under `wiki/`, including title and relative path.

`get_wiki_overview`

- Input: none.
- Output: concatenated high-level project context from `purpose.md`, `wiki/overview.md`, and `wiki/index.md` when present.

## Data Flow

Codex starts the MCP process with `node mcp-server/dist/index.js --project <projectPath>`.

The MCP process validates the project path, walks `wiki/**/*.md`, reads Markdown as UTF-8, extracts frontmatter title or first heading, and returns tool results as JSON text content.

## Error Handling

Startup fails if `--project` is missing or the path does not contain a `wiki/` directory.

Tool calls return structured errors for empty queries, unresolved pages, and unsafe paths.

## Testing

Tests cover listing, Chinese keyword search, page resolution by title/path, overview aggregation, and path traversal protection.
