#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import { createWikiProvider, type WikiProviderConfig } from "./provider.js"

function getArg(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] : undefined
}

function parseProviderConfig(argv: string[]): WikiProviderConfig {
  const mode = getArg(argv, "--mode") ?? "local"
  if (mode === "local") {
    const projectPath = getArg(argv, "--project")
    if (!projectPath) {
      throw new Error("Usage: llm-wiki-mcp --project <projectPath>")
    }
    return { mode: "local", projectPath }
  }

  if (mode === "cloud") {
    return {
      mode: "cloud",
      baseUrl: getArg(argv, "--base-url"),
      projectId: getArg(argv, "--project-id"),
      apiKey: getArg(argv, "--api-key"),
    }
  }

  throw new Error(`Unsupported provider mode: ${mode}`)
}

function jsonContent(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  }
}

async function main(): Promise<void> {
  const wiki = await createWikiProvider(parseProviderConfig(process.argv.slice(2)))

  const server = new McpServer({
    name: "llm-wiki",
    version: "0.1.0",
  })

  server.registerTool(
    "search_wiki",
    {
      title: "Search LLM Wiki",
      description: "Search Markdown pages under the configured LLM Wiki project's wiki directory.",
      inputSchema: {
        query: z.string().min(1),
        limit: z.number().int().min(1).max(50).optional(),
      },
    },
    async ({ query, limit }) => jsonContent(await wiki.search(query, limit)),
  )

  server.registerTool(
    "read_wiki_page",
    {
      title: "Read LLM Wiki Page",
      description: "Read a wiki page by title, absolute path inside the project, wiki-relative path, or filename.",
      inputSchema: {
        path_or_title: z.string().min(1),
      },
    },
    async ({ path_or_title }) => jsonContent(await wiki.readPage(path_or_title)),
  )

  server.registerTool(
    "list_wiki_pages",
    {
      title: "List LLM Wiki Pages",
      description: "List all Markdown pages under the configured LLM Wiki project's wiki directory.",
    },
    async () => {
      const pages = await wiki.listPages()
      return jsonContent(pages.map((page) => ({
        title: page.title,
        relativePath: page.relativePath,
      })))
    },
  )

  server.registerTool(
    "get_wiki_overview",
    {
      title: "Get LLM Wiki Overview",
      description: "Read high-level context from purpose.md, wiki/overview.md, and wiki/index.md.",
    },
    async () => jsonContent({ content: await wiki.getOverview() }),
  )

  await server.connect(new StdioServerTransport())
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[llm-wiki-mcp] ${message}`)
  process.exit(1)
})
