# LLM Wiki MCP Cloud API Contract

The MCP server supports two provider modes:

- `local`: reads a local LLM Wiki project directory.
- `cloud`: calls a hosted LLM Wiki HTTP API.

Cloud mode is selected with:

```powershell
node C:/Project/llm_wiki/mcp-server/dist/index.js `
  --mode cloud `
  --base-url https://wiki.example.com `
  --project-id proj_123
```

Authentication uses a bearer token. Prefer environment variables over command-line arguments:

```toml
[mcp_servers.llm-wiki]
type = "stdio"
command = "node"
args = [
  "C:/Project/llm_wiki/mcp-server/dist/index.js",
  "--mode",
  "cloud",
  "--base-url",
  "https://wiki.example.com",
  "--project-id",
  "proj_123",
]
startup_timeout_ms = 20000

[mcp_servers.llm-wiki.env]
LLM_WIKI_API_KEY = "replace-with-token"
```

## Required Headers

Every request includes:

```http
Authorization: Bearer <LLM_WIKI_API_KEY>
Accept: application/json
Content-Type: application/json
```

The server must validate that the token can access `projectId`.

## ASP.NET Backend Configuration

The included .NET backend reads cloud API settings from the `LlmWikiCloud` configuration section.

`appsettings.json` shape:

```json
{
  "LlmWikiCloud": {
    "ApiKey": "replace-with-server-token",
    "Projects": {
      "proj_123": "C:/Project/wiki/产品"
    }
  }
}
```

For deployment, prefer environment variables:

```text
LlmWikiCloud__ApiKey=replace-with-server-token
LlmWikiCloud__Projects__proj_123=/data/wiki/product
```

`projectId` in the MCP config must match a key under `LlmWikiCloud:Projects`.

## Endpoints

### List Pages

```http
GET /api/projects/{projectId}/wiki/pages
```

Response may be either an array or an object with `pages`:

```json
{
  "pages": [
    {
      "title": "盘古网络假期政策",
      "relativePath": "wiki/concepts/盘古网络假期政策.md"
    }
  ]
}
```

### Search Pages

```http
POST /api/projects/{projectId}/wiki/search
```

Request:

```json
{
  "query": "假期",
  "limit": 10
}
```

Response may be either an array or an object with `results`:

```json
{
  "results": [
    {
      "title": "盘古网络假期政策",
      "relativePath": "wiki/concepts/盘古网络假期政策.md",
      "snippet": "年假、婚假、产假...",
      "score": 0.91
    }
  ]
}
```

### Read Page

```http
GET /api/projects/{projectId}/wiki/pages/read?path_or_title={value}
```

Response:

```json
{
  "title": "盘古网络假期政策",
  "relativePath": "wiki/concepts/盘古网络假期政策.md",
  "content": "# 盘古网络假期政策\n\n..."
}
```

### Overview

```http
GET /api/projects/{projectId}/wiki/overview
```

Response may be either a string or an object with `content`:

```json
{
  "content": "# purpose.md\n\n...\n\n---\n\n# wiki/overview.md\n\n..."
}
```

## Error Contract

Use normal HTTP status codes:

- `401`: missing or invalid token.
- `403`: token cannot access the project.
- `404`: project or page not found.
- `422`: invalid query or page identifier.
- `500`: server error.

The MCP server surfaces non-2xx responses as tool errors with the response body appended when available.
