# Deploy PanGuWiki

This repository can be deployed with Docker Compose as:

- `web`: Nginx serving the Vite frontend and proxying API/WebSocket traffic.
- `api`: ASP.NET Core backend on port `5200`.
- `qdrant`: optional vector database used by embedding search.

## 1. Prepare Server

Install Docker and Docker Compose on the server, then clone the branch:

```bash
git clone https://github.com/KalebPeng/PanGuWiki.git
cd PanGuWiki
git checkout codex/llm-wiki-mcp-cloud
```

Create an env file:

```bash
cp .env.deploy.example .env.deploy
```

Edit `.env.deploy`:

```bash
WEB_PORT=8080
PUBLIC_ORIGIN=https://wiki.example.com
LLM_WIKI_API_KEY=replace-with-a-long-random-token
WIKI_PROJECT_PATH=/absolute/path/to/your/wiki/project
```

`WIKI_PROJECT_PATH` must point to an LLM Wiki project directory containing `wiki/` and `schema.md`.

## 2. Start

```bash
docker compose --env-file .env.deploy up -d --build
```

Check health:

```bash
curl http://localhost:8080/health
```

## 3. Reverse Proxy

Point your external reverse proxy to the compose web port, for example:

```text
https://wiki.example.com -> http://127.0.0.1:8080
```

The included Nginx container already proxies:

- `/api/*` -> ASP.NET backend
- `/health` -> ASP.NET backend
- `/ws/*` -> ASP.NET backend WebSocket endpoints

## 4. Codex MCP Cloud Config

After deployment, configure Codex:

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
LLM_WIKI_API_KEY = "same-token-as-server"
```

The Docker Compose backend maps `proj_123` to `/data/wiki/project`, which is mounted from `WIKI_PROJECT_PATH`.
