# .NET Backend Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the Rust/Tauri backend to ASP.NET Core 8 running as a local HTTP server on port 5200, keeping the React frontend unchanged, enabling cloud migration by changing one config value.

**Architecture:** The frontend already has three abstraction files that wrap all `invoke()` calls (`src/commands/fs.ts`, `src/lib/claude-cli-transport.ts`, `src/lib/embedding.ts`). Each file is modified phase-by-phase to route to the .NET HTTP API when `VITE_DOTNET_BACKEND=1` is set. Claude streaming switches from Tauri events to WebSocket. The .NET project lives at `llm-wiki-server/` in the same repo.

**Tech Stack:** ASP.NET Core 8 Minimal API, xUnit + WebApplicationFactory (backend tests), Qdrant.Client 1.x (vector store), UglyToad.PdfPig (PDF text), DocumentFormat.OpenXml + ClosedXML (Office), System.Diagnostics.Process (claude CLI subprocess), Vitest (frontend tests already configured)

**Design doc:** `plans/2026-05-07-dotnet-backend-migration-design.md`

---

## File Map

### New files — .NET backend

```
llm-wiki-server/
├── LlmWiki.sln
├── src/LlmWiki.Api/
│   ├── LlmWiki.Api.csproj
│   ├── Program.cs
│   ├── appsettings.json
│   ├── appsettings.Development.json
│   ├── Models/
│   │   ├── FileNode.cs
│   │   ├── WikiProject.cs
│   │   ├── VectorModels.cs          # VectorSearchResult, ChunkSearchResult, ChunkUpsertInput
│   │   └── ApiError.cs
│   ├── Services/
│   │   ├── ProjectService.cs
│   │   ├── FileService.cs           # read/write/list/copy/delete + PDF/Office text extraction
│   │   ├── ClaudeCliService.cs      # detect + spawn/kill subprocess
│   │   ├── ProxyService.cs
│   │   ├── PdfExtractService.cs     # PdfPig-based extraction
│   │   ├── OfficeExtractService.cs  # OpenXml-based extraction
│   │   └── VectorService.cs         # Qdrant wrapper
│   ├── Controllers/
│   │   ├── ProjectController.cs
│   │   ├── FileController.cs
│   │   ├── ClaudeController.cs      # GET /api/claude/detect only
│   │   ├── ProxyController.cs
│   │   ├── ExtractController.cs
│   │   └── VectorController.cs
│   └── Hubs/
│       └── ClaudeWebSocket.cs       # raw WebSocket handler (not SignalR)
└── tests/LlmWiki.Api.Tests/
    ├── LlmWiki.Api.Tests.csproj
    ├── ProjectServiceTests.cs
    ├── FileServiceTests.cs
    └── VectorServiceTests.cs
```

### Modified files — frontend

```
src/api/dotnet-client.ts             # NEW: thin HTTP helper (GET/POST/DELETE)
src/commands/fs.ts                   # route fs/project/clip to .NET when env var set
src/lib/claude-cli-transport.ts      # add WebSocket implementation alongside Tauri
src/lib/embedding.ts                 # route vector invoke calls to .NET HTTP
```

---

## Phase P0: Foundation

### Task 1: Create .NET solution skeleton

**Files:**
- Create: `llm-wiki-server/LlmWiki.sln`
- Create: `llm-wiki-server/src/LlmWiki.Api/LlmWiki.Api.csproj`
- Create: `llm-wiki-server/src/LlmWiki.Api/Program.cs`
- Create: `llm-wiki-server/src/LlmWiki.Api/appsettings.json`
- Create: `llm-wiki-server/tests/LlmWiki.Api.Tests/LlmWiki.Api.Tests.csproj`

- [ ] **Step 1: Scaffold solution and projects**

Run from repo root:
```bash
mkdir llm-wiki-server && cd llm-wiki-server
dotnet new sln -n LlmWiki
dotnet new webapi -n LlmWiki.Api -o src/LlmWiki.Api --no-openapi
dotnet new xunit -n LlmWiki.Api.Tests -o tests/LlmWiki.Api.Tests
dotnet sln add src/LlmWiki.Api/LlmWiki.Api.csproj
dotnet sln add tests/LlmWiki.Api.Tests/LlmWiki.Api.Tests.csproj
cd tests/LlmWiki.Api.Tests
dotnet add reference ../../src/LlmWiki.Api/LlmWiki.Api.csproj
```

- [ ] **Step 2: Add NuGet packages to API project**

```bash
cd ../../src/LlmWiki.Api
dotnet add package Qdrant.Client --version 1.10.0
dotnet add package UglyToad.PdfPig --version 0.1.9
dotnet add package DocumentFormat.OpenXml --version 3.0.2
dotnet add package ClosedXML --version 0.102.2
```

- [ ] **Step 3: Add test packages**

```bash
cd ../../tests/LlmWiki.Api.Tests
dotnet add package Microsoft.AspNetCore.Mvc.Testing --version 8.0.0
dotnet add package xunit --version 2.9.0
```

- [ ] **Step 4: Write `LlmWiki.Api.csproj`**

Replace the scaffolded csproj at `llm-wiki-server/src/LlmWiki.Api/LlmWiki.Api.csproj`:

```xml
<Project Sdk="Microsoft.NET.Sdk.Web">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <RootNamespace>LlmWiki.Api</RootNamespace>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Qdrant.Client" Version="1.10.0" />
    <PackageReference Include="UglyToad.PdfPig" Version="0.1.9" />
    <PackageReference Include="DocumentFormat.OpenXml" Version="3.0.2" />
    <PackageReference Include="ClosedXML" Version="0.102.2" />
  </ItemGroup>
</Project>
```

- [ ] **Step 5: Write `Program.cs`**

`llm-wiki-server/src/LlmWiki.Api/Program.cs`:

```csharp
using LlmWiki.Api.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();

builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy
            .WithOrigins(
                "tauri://localhost",
                "https://tauri.localhost",
                "http://localhost:1420",
                "http://localhost:5173")
            .AllowAnyHeader()
            .AllowAnyMethod();
    });
});

builder.Services.AddSingleton<ProjectService>();
builder.Services.AddSingleton<FileService>();
builder.Services.AddSingleton<ProxyService>();
builder.Services.AddSingleton<ClaudeCliService>();
builder.Services.AddSingleton<PdfExtractService>();
builder.Services.AddSingleton<OfficeExtractService>();
builder.Services.AddSingleton<VectorService>();

var app = builder.Build();

app.UseCors();
app.UseWebSockets();
app.MapControllers();
app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

app.Run("http://localhost:5200");
```

- [ ] **Step 6: Write `appsettings.json`**

`llm-wiki-server/src/LlmWiki.Api/appsettings.json`:

```json
{
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.AspNetCore": "Warning"
    }
  },
  "Qdrant": {
    "Host": "localhost",
    "Port": 6334,
    "ApiKey": ""
  }
}
```

- [ ] **Step 7: Verify the project builds**

```bash
cd llm-wiki-server
dotnet build
```

Expected: `Build succeeded. 0 Error(s)`

- [ ] **Step 8: Write smoke test**

`llm-wiki-server/tests/LlmWiki.Api.Tests/HealthCheckTests.cs`:

```csharp
using Microsoft.AspNetCore.Mvc.Testing;

namespace LlmWiki.Api.Tests;

public class HealthCheckTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    [Fact]
    public async Task HealthEndpoint_Returns200()
    {
        var client = factory.CreateClient();
        var response = await client.GetAsync("/health");
        Assert.Equal(System.Net.HttpStatusCode.OK, response.StatusCode);
    }
}
```

- [ ] **Step 9: Run test**

```bash
cd llm-wiki-server
dotnet test
```

Expected: `Passed! - Failed: 0, Passed: 1`

- [ ] **Step 10: Make `Program.cs` testable**

Add `public partial class Program {}` at the end of `Program.cs` so `WebApplicationFactory<Program>` can find the entry point:

```csharp
// At the very bottom of Program.cs
public partial class Program { }
```

- [ ] **Step 11: Commit**

```bash
cd ..  # back to repo root
git add llm-wiki-server/
git commit -m "feat: scaffold ASP.NET Core 8 backend project"
```

---

### Task 2: Create frontend HTTP client helper

**Files:**
- Create: `src/api/dotnet-client.ts`

- [ ] **Step 1: Write failing test**

`src/api/dotnet-client.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { httpGet, httpPost, httpDelete } from './dotnet-client'

describe('dotnet-client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  it('httpGet calls fetch with correct URL', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    )
    const result = await httpGet<{ ok: boolean }>('/health')
    expect(fetch).toHaveBeenCalledWith('http://localhost:5200/health')
    expect(result).toEqual({ ok: true })
  })

  it('httpPost sends JSON body', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ created: true }), { status: 200 })
    )
    await httpPost('/api/project/create', { name: 'test', path: '/tmp' })
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:5200/api/project/create',
      expect.objectContaining({ method: 'POST', body: '{"name":"test","path":"/tmp"}' })
    )
  })

  it('httpGet throws on non-OK response', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: 'not found' }), { status: 404 })
    )
    await expect(httpGet('/api/file/read?path=/x')).rejects.toThrow('not found')
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npm run test:mocks -- src/api/dotnet-client.test.ts
```

Expected: FAIL — `Cannot find module './dotnet-client'`

- [ ] **Step 3: Write implementation**

`src/api/dotnet-client.ts`:

```typescript
const BASE_URL = import.meta.env.VITE_DOTNET_URL ?? 'http://localhost:5200'

async function parseError(res: Response): Promise<string> {
  try {
    const body = await res.json()
    return body?.error ?? res.statusText
  } catch {
    return res.statusText
  }
}

export async function httpGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`)
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function httpPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function httpDelete<T = void>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await parseError(res))
  if (res.status === 204) return undefined as T
  return res.json()
}
```

- [ ] **Step 4: Run tests**

```bash
npm run test:mocks -- src/api/dotnet-client.test.ts
```

Expected: `✓ 3 tests passed`

- [ ] **Step 5: Commit**

```bash
git add src/api/dotnet-client.ts src/api/dotnet-client.test.ts
git commit -m "feat: add dotnet HTTP client helper"
```

---

## Phase P1: Project + Proxy + Status

### Task 3: ProjectService + ProjectController

**Files:**
- Create: `llm-wiki-server/src/LlmWiki.Api/Models/WikiProject.cs`
- Create: `llm-wiki-server/src/LlmWiki.Api/Services/ProjectService.cs`
- Create: `llm-wiki-server/src/LlmWiki.Api/Controllers/ProjectController.cs`
- Create: `llm-wiki-server/tests/LlmWiki.Api.Tests/ProjectServiceTests.cs`

- [ ] **Step 1: Write models**

`llm-wiki-server/src/LlmWiki.Api/Models/WikiProject.cs`:

```csharp
namespace LlmWiki.Api.Models;

public record WikiProject(string Name, string Path);

public record CreateProjectRequest(string Name, string Path);

public record OpenProjectRequest(string Path);
```

- [ ] **Step 2: Write failing tests**

`llm-wiki-server/tests/LlmWiki.Api.Tests/ProjectServiceTests.cs`:

```csharp
using LlmWiki.Api.Services;

namespace LlmWiki.Api.Tests;

public class ProjectServiceTests : IDisposable
{
    private readonly string _tempDir = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString());
    private readonly ProjectService _sut = new();

    public void Dispose() => Directory.Delete(_tempDir, recursive: true);

    [Fact]
    public void CreateProject_CreatesRequiredDirectories()
    {
        var result = _sut.CreateProject("my-wiki", _tempDir);

        Assert.Equal("my-wiki", result.Name);
        Assert.True(Directory.Exists(Path.Combine(result.Path, "wiki")));
        Assert.True(Directory.Exists(Path.Combine(result.Path, "raw/sources")));
        Assert.True(File.Exists(Path.Combine(result.Path, "schema.md")));
        Assert.True(File.Exists(Path.Combine(result.Path, "wiki/index.md")));
    }

    [Fact]
    public void CreateProject_ThrowsWhenDirectoryExists()
    {
        _sut.CreateProject("dup", _tempDir);
        var ex = Assert.Throws<InvalidOperationException>(() => _sut.CreateProject("dup", _tempDir));
        Assert.Contains("already exists", ex.Message);
    }

    [Fact]
    public void OpenProject_ReturnsProjectForValidPath()
    {
        var created = _sut.CreateProject("open-test", _tempDir);
        var opened = _sut.OpenProject(created.Path);
        Assert.Equal("open-test", opened.Name);
        Assert.Equal(created.Path, opened.Path);
    }

    [Fact]
    public void OpenProject_ThrowsWhenMissingSchemaFile()
    {
        Directory.CreateDirectory(_tempDir);
        Directory.CreateDirectory(Path.Combine(_tempDir, "wiki"));
        // No schema.md
        var ex = Assert.Throws<InvalidOperationException>(() => _sut.OpenProject(_tempDir));
        Assert.Contains("schema.md", ex.Message);
    }
}
```

- [ ] **Step 3: Run tests to verify failure**

```bash
cd llm-wiki-server && dotnet test --filter ProjectServiceTests
```

Expected: FAIL — `LlmWiki.Api.Services.ProjectService does not exist`

- [ ] **Step 4: Write `ProjectService.cs`**

`llm-wiki-server/src/LlmWiki.Api/Services/ProjectService.cs`:

```csharp
using LlmWiki.Api.Models;

namespace LlmWiki.Api.Services;

public class ProjectService
{
    public WikiProject CreateProject(string name, string basePath)
    {
        var root = Path.Combine(basePath, name);
        if (Directory.Exists(root))
            throw new InvalidOperationException($"Directory already exists: '{root}'");

        string[] dirs = [
            "raw/sources", "raw/assets",
            "wiki/entities", "wiki/concepts", "wiki/sources",
            "wiki/queries", "wiki/comparisons", "wiki/synthesis"
        ];
        foreach (var d in dirs)
            Directory.CreateDirectory(Path.Combine(root, d));

        var today = DateTime.Now.ToString("yyyy-MM-dd");

        WriteFile(root, "schema.md", SchemaContent());
        WriteFile(root, "purpose.md", PurposeContent());
        WriteFile(root, "wiki/index.md", "# Wiki Index\n\n## Entities\n\n## Concepts\n\n## Sources\n\n## Queries\n\n## Comparisons\n\n## Synthesis\n");
        WriteFile(root, "wiki/log.md", $"# Research Log\n\n## {today}\n\n- Project created\n");
        WriteFile(root, "wiki/overview.md", "---\ntype: overview\ntitle: Project Overview\ntags: []\nrelated: []\n---\n\n# Overview\n\n<!-- High-level summary -->\n");

        Directory.CreateDirectory(Path.Combine(root, ".obsidian"));
        WriteFile(root, ".obsidian/app.json", """{"attachmentFolderPath":"raw/assets","useMarkdownLinks":false,"newLinkFormat":"shortest"}""");
        WriteFile(root, ".obsidian/appearance.json", """{"baseFontSize":16,"theme":"obsidian"}""");

        return new WikiProject(name, NormalizePath(root));
    }

    public WikiProject OpenProject(string path)
    {
        if (!Directory.Exists(path))
            throw new InvalidOperationException($"Path does not exist: '{path}'");
        if (!File.Exists(Path.Combine(path, "schema.md")))
            throw new InvalidOperationException($"Not a valid wiki project (missing schema.md): '{path}'");
        if (!Directory.Exists(Path.Combine(path, "wiki")))
            throw new InvalidOperationException($"Not a valid wiki project (missing wiki/): '{path}'");

        var name = new DirectoryInfo(path).Name;
        return new WikiProject(name, NormalizePath(path));
    }

    private static void WriteFile(string root, string relative, string content)
    {
        var full = Path.Combine(root, relative);
        Directory.CreateDirectory(Path.GetDirectoryName(full)!);
        File.WriteAllText(full, content);
    }

    private static string NormalizePath(string p) => p.Replace('\\', '/');

    private static string SchemaContent() => """
        # Wiki Schema

        ## Page Types

        | Type | Directory | Purpose |
        |------|-----------|---------|
        | entity | wiki/entities/ | Named things |
        | concept | wiki/concepts/ | Ideas and techniques |
        | source | wiki/sources/ | Papers and articles |
        | query | wiki/queries/ | Open questions |
        | comparison | wiki/comparisons/ | Side-by-side analysis |
        | synthesis | wiki/synthesis/ | Cross-cutting summaries |

        ## Frontmatter

        ```yaml
        ---
        type: entity
        title: Title
        tags: []
        related: []
        created: YYYY-MM-DD
        updated: YYYY-MM-DD
        ---
        ```
        """;

    private static string PurposeContent() => """
        # Project Purpose

        ## Goal

        <!-- What are you trying to understand or build? -->

        ## Key Questions

        1.
        2.
        3.

        ## Thesis

        > TBD
        """;
}
```

- [ ] **Step 5: Write `ProjectController.cs`**

`llm-wiki-server/src/LlmWiki.Api/Controllers/ProjectController.cs`:

```csharp
using LlmWiki.Api.Models;
using LlmWiki.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace LlmWiki.Api.Controllers;

[ApiController]
[Route("api/project")]
public class ProjectController(ProjectService projectService) : ControllerBase
{
    [HttpPost("create")]
    public IActionResult Create([FromBody] CreateProjectRequest req)
    {
        try
        {
            var project = projectService.CreateProject(req.Name, req.Path);
            return Ok(project);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpPost("open")]
    public IActionResult Open([FromBody] OpenProjectRequest req)
    {
        try
        {
            var project = projectService.OpenProject(req.Path);
            return Ok(project);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }
}
```

- [ ] **Step 6: Run tests**

```bash
cd llm-wiki-server && dotnet test --filter ProjectServiceTests
```

Expected: `Passed! - Failed: 0, Passed: 4`

- [ ] **Step 7: Update `src/commands/fs.ts` to route project commands**

In `src/commands/fs.ts`, add the dotnet routing for `createProject` and `openProject`:

```typescript
import { invoke } from "@tauri-apps/api/core"
import type { FileNode, WikiProject } from "@/types/wiki"
import { ensureProjectId, upsertProjectInfo } from "@/lib/project-identity"
import { httpPost } from "@/api/dotnet-client"

const USE_DOTNET = import.meta.env.VITE_DOTNET_BACKEND === '1'

// ... keep all existing functions unchanged ...

export async function createProject(name: string, path: string): Promise<WikiProject> {
  if (USE_DOTNET) {
    const raw = await httpPost<{ name: string; path: string }>('/api/project/create', { name, path })
    const id = await ensureProjectId(raw.path)
    await upsertProjectInfo(id, raw.path, raw.name)
    return { id, name: raw.name, path: raw.path }
  }
  const raw = await invoke<{ name: string; path: string }>("create_project", { name, path })
  const id = await ensureProjectId(raw.path)
  await upsertProjectInfo(id, raw.path, raw.name)
  return { id, name: raw.name, path: raw.path }
}

export async function openProject(path: string): Promise<WikiProject> {
  if (USE_DOTNET) {
    const raw = await httpPost<{ name: string; path: string }>('/api/project/open', { path })
    const id = await ensureProjectId(raw.path)
    await upsertProjectInfo(id, raw.path, raw.name)
    return { id, name: raw.name, path: raw.path }
  }
  const raw = await invoke<{ name: string; path: string }>("open_project", { path })
  const id = await ensureProjectId(raw.path)
  await upsertProjectInfo(id, raw.path, raw.name)
  return { id, name: raw.name, path: raw.path }
}
```

- [ ] **Step 8: Commit**

```bash
git add llm-wiki-server/src/LlmWiki.Api/Models/WikiProject.cs
git add llm-wiki-server/src/LlmWiki.Api/Services/ProjectService.cs
git add llm-wiki-server/src/LlmWiki.Api/Controllers/ProjectController.cs
git add llm-wiki-server/tests/LlmWiki.Api.Tests/ProjectServiceTests.cs
git add src/commands/fs.ts
git commit -m "feat(p1): project create/open endpoints + frontend routing"
```

---

### Task 4: ProxyController + StatusController

**Files:**
- Create: `llm-wiki-server/src/LlmWiki.Api/Services/ProxyService.cs`
- Create: `llm-wiki-server/src/LlmWiki.Api/Controllers/ProxyController.cs`
- Create: `llm-wiki-server/src/LlmWiki.Api/Controllers/StatusController.cs`

- [ ] **Step 1: Write `ProxyService.cs`**

`llm-wiki-server/src/LlmWiki.Api/Services/ProxyService.cs`:

```csharp
namespace LlmWiki.Api.Services;

public record ProxyConfig(
    bool Enabled,
    string? HttpProxy,
    string? HttpsProxy,
    string? NoProxy);

public class ProxyService
{
    public string ApplyProxy(ProxyConfig config)
    {
        if (!config.Enabled)
        {
            Environment.SetEnvironmentVariable("HTTP_PROXY", null);
            Environment.SetEnvironmentVariable("HTTPS_PROXY", null);
            Environment.SetEnvironmentVariable("NO_PROXY", null);
            return "proxy disabled";
        }

        if (!string.IsNullOrEmpty(config.HttpProxy))
            Environment.SetEnvironmentVariable("HTTP_PROXY", config.HttpProxy);
        if (!string.IsNullOrEmpty(config.HttpsProxy))
            Environment.SetEnvironmentVariable("HTTPS_PROXY", config.HttpsProxy);
        if (!string.IsNullOrEmpty(config.NoProxy))
            Environment.SetEnvironmentVariable("NO_PROXY", config.NoProxy);

        return $"proxy set: HTTP={config.HttpProxy} HTTPS={config.HttpsProxy}";
    }
}
```

- [ ] **Step 2: Write `ProxyController.cs`**

`llm-wiki-server/src/LlmWiki.Api/Controllers/ProxyController.cs`:

```csharp
using LlmWiki.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace LlmWiki.Api.Controllers;

[ApiController]
[Route("api/proxy")]
public class ProxyController(ProxyService proxyService) : ControllerBase
{
    [HttpPost("set")]
    public IActionResult Set([FromBody] ProxyConfig config)
    {
        var summary = proxyService.ApplyProxy(config);
        return Ok(new { summary });
    }
}
```

- [ ] **Step 3: Write `StatusController.cs`**

`llm-wiki-server/src/LlmWiki.Api/Controllers/StatusController.cs`:

```csharp
using Microsoft.AspNetCore.Mvc;

namespace LlmWiki.Api.Controllers;

[ApiController]
[Route("api/status")]
public class StatusController : ControllerBase
{
    // clip_server is a macOS-only feature; on .NET we return a static status.
    [HttpGet("clip")]
    public IActionResult Clip() => Ok("not-supported");
}
```

- [ ] **Step 4: Verify build**

```bash
cd llm-wiki-server && dotnet build
```

Expected: `Build succeeded. 0 Error(s)`

- [ ] **Step 5: Update `src/commands/fs.ts` for proxy + clip**

Add `USE_DOTNET` routing to `clipServerStatus` in `fs.ts`:

```typescript
export async function clipServerStatus(): Promise<string> {
  if (USE_DOTNET) {
    return httpGet<string>('/api/status/clip')
  }
  return invoke<string>("clip_server_status")
}
```

- [ ] **Step 6: Commit**

```bash
git add llm-wiki-server/src/LlmWiki.Api/Services/ProxyService.cs
git add llm-wiki-server/src/LlmWiki.Api/Controllers/ProxyController.cs
git add llm-wiki-server/src/LlmWiki.Api/Controllers/StatusController.cs
git add src/commands/fs.ts
git commit -m "feat(p1): proxy + status endpoints"
```

---

## Phase P2: File System

### Task 5: FileService — basic operations

**Files:**
- Create: `llm-wiki-server/src/LlmWiki.Api/Models/FileNode.cs`
- Create: `llm-wiki-server/src/LlmWiki.Api/Services/FileService.cs` (basic ops only)
- Create: `llm-wiki-server/tests/LlmWiki.Api.Tests/FileServiceTests.cs`

- [ ] **Step 1: Write `FileNode.cs`**

`llm-wiki-server/src/LlmWiki.Api/Models/FileNode.cs`:

```csharp
namespace LlmWiki.Api.Models;

public record FileNode(string Name, string Path, bool IsDir, List<FileNode>? Children);
```

- [ ] **Step 2: Write failing tests**

`llm-wiki-server/tests/LlmWiki.Api.Tests/FileServiceTests.cs`:

```csharp
using LlmWiki.Api.Services;

namespace LlmWiki.Api.Tests;

public class FileServiceTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString());
    private readonly FileService _sut = new(new PdfExtractService(), new OfficeExtractService());

    public FileServiceTests() => Directory.CreateDirectory(_dir);
    public void Dispose() => Directory.Delete(_dir, recursive: true);

    [Fact]
    public async Task ReadFile_ReturnsContent()
    {
        var path = Path.Combine(_dir, "test.md");
        await File.WriteAllTextAsync(path, "# Hello");
        var content = await _sut.ReadFile(path);
        Assert.Equal("# Hello", content);
    }

    [Fact]
    public async Task WriteFile_CreatesFile()
    {
        var path = Path.Combine(_dir, "sub", "new.md");
        await _sut.WriteFile(path, "content");
        Assert.Equal("content", await File.ReadAllTextAsync(path));
    }

    [Fact]
    public async Task FileExists_ReturnsTrueForExistingFile()
    {
        var path = Path.Combine(_dir, "exists.md");
        await File.WriteAllTextAsync(path, "x");
        Assert.True(await _sut.FileExists(path));
        Assert.False(await _sut.FileExists(path + ".nope"));
    }

    [Fact]
    public async Task ListDirectory_ReturnsTree()
    {
        await File.WriteAllTextAsync(Path.Combine(_dir, "a.md"), "");
        var subDir = Directory.CreateDirectory(Path.Combine(_dir, "sub"));
        await File.WriteAllTextAsync(Path.Combine(subDir.FullName, "b.md"), "");

        var nodes = await _sut.ListDirectory(_dir);

        Assert.Contains(nodes, n => n.Name == "a.md" && !n.IsDir);
        Assert.Contains(nodes, n => n.Name == "sub" && n.IsDir);
        var sub = nodes.First(n => n.Name == "sub");
        Assert.Contains(sub.Children!, n => n.Name == "b.md");
    }

    [Fact]
    public async Task DeleteFile_RemovesFile()
    {
        var path = Path.Combine(_dir, "del.md");
        await File.WriteAllTextAsync(path, "x");
        await _sut.DeleteFile(path);
        Assert.False(File.Exists(path));
    }
}
```

- [ ] **Step 3: Run to verify failure**

```bash
cd llm-wiki-server && dotnet test --filter FileServiceTests
```

Expected: FAIL — `FileService does not exist`

- [ ] **Step 4: Write `FileService.cs` basic ops**

`llm-wiki-server/src/LlmWiki.Api/Services/FileService.cs`:

```csharp
using LlmWiki.Api.Models;

namespace LlmWiki.Api.Services;

public class FileService(PdfExtractService pdfExtract, OfficeExtractService officeExtract)
{
    private static readonly string[] OfficeExts = ["docx", "pptx", "xlsx", "odt", "ods", "odp"];
    private static readonly string[] ImageExts = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "tiff", "tif", "avif", "heic", "heif", "svg"];
    private static readonly string[] MediaExts = ["mp4", "webm", "mov", "avi", "mkv", "flv", "mp3", "wav", "ogg", "flac", "aac", "m4a"];
    private static readonly string[] LegacyExts = ["doc", "xls", "ppt", "pages", "numbers", "key", "epub"];

    public async Task<string> ReadFile(string path)
    {
        var ext = Path.GetExtension(path).TrimStart('.').ToLowerInvariant();

        if (TryReadCache(path, out var cached)) return cached!;

        if (ext == "pdf") return await pdfExtract.ExtractText(path);
        if (OfficeExts.Contains(ext)) return await officeExtract.ExtractText(path, ext);
        if (ImageExts.Contains(ext))
        {
            var size = new FileInfo(path).Length;
            return $"[Image: {Path.GetFileName(path)} ({size / 1024.0:F1} KB)]";
        }
        if (MediaExts.Contains(ext))
        {
            var size = new FileInfo(path).Length;
            return $"[Media: {Path.GetFileName(path)} ({size / 1048576.0:F1} MB)]";
        }
        if (LegacyExts.Contains(ext))
            return $"[Document: {Path.GetFileName(path)} — text extraction not supported for .{ext} format]";

        return await File.ReadAllTextAsync(path);
    }

    public async Task WriteFile(string path, string contents)
    {
        var dir = Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
        await File.WriteAllTextAsync(path, contents);
    }

    public Task<bool> FileExists(string path) =>
        Task.FromResult(File.Exists(path) || Directory.Exists(path));

    public async Task<string> PreprocessFile(string path)
    {
        var ext = Path.GetExtension(path).TrimStart('.').ToLowerInvariant();
        string text;
        if (ext == "pdf") text = await pdfExtract.ExtractText(path);
        else if (OfficeExts.Contains(ext)) text = await officeExtract.ExtractText(path, ext);
        else return "no preprocessing needed";

        WriteCache(path, text);
        return text;
    }

    public Task<List<FileNode>> ListDirectory(string path, int maxDepth = 30) =>
        Task.FromResult(BuildTree(path, 0, maxDepth));

    public Task CreateDirectory(string path)
    {
        Directory.CreateDirectory(path);
        return Task.CompletedTask;
    }

    public Task DeleteFile(string path)
    {
        if (Directory.Exists(path)) Directory.Delete(path, recursive: true);
        else if (File.Exists(path)) File.Delete(path);
        return Task.CompletedTask;
    }

    public async Task CopyFile(string source, string destination)
    {
        var dir = Path.GetDirectoryName(destination);
        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
        File.Copy(source, destination, overwrite: true);
        await Task.CompletedTask;
    }

    public Task<List<string>> CopyDirectory(string source, string destination)
    {
        var copied = new List<string>();
        CopyRecursive(source, destination, copied);
        return Task.FromResult(copied);
    }

    public async Task<(string Base64, string MimeType)> ReadFileAsBase64(string path)
    {
        var bytes = await File.ReadAllBytesAsync(path);
        var ext = Path.GetExtension(path).TrimStart('.').ToLowerInvariant();
        var mime = ext switch
        {
            "png" => "image/png",
            "jpg" or "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "webp" => "image/webp",
            "bmp" => "image/bmp",
            "tiff" or "tif" => "image/tiff",
            "svg" => "image/svg+xml",
            _ => "application/octet-stream"
        };
        return (Convert.ToBase64String(bytes), mime);
    }

    public Task<List<string>> FindRelatedWikiPages(string projectPath, string sourceName)
    {
        var wikiDir = Path.Combine(projectPath, "wiki");
        if (!Directory.Exists(wikiDir)) return Task.FromResult(new List<string>());
        var results = new List<string>();
        CollectRelatedPages(wikiDir, sourceName, results);
        return Task.FromResult(results);
    }

    // ── Private helpers ──────────────────────────────────────────────────

    private static List<FileNode> BuildTree(string dir, int depth, int maxDepth)
    {
        if (depth >= maxDepth) return [];
        var entries = Directory.GetFileSystemEntries(dir)
            .Where(e => !Path.GetFileName(e).StartsWith('.'))
            .OrderBy(e => !Directory.Exists(e))
            .ThenBy(e => Path.GetFileName(e));

        return entries.Select(e =>
        {
            var name = Path.GetFileName(e);
            var isDir = Directory.Exists(e);
            var normPath = e.Replace('\\', '/');
            var children = isDir ? BuildTree(e, depth + 1, maxDepth) : null;
            return new FileNode(name, normPath, isDir, children?.Count > 0 ? children : null);
        }).ToList();
    }

    private static void CopyRecursive(string src, string dest, List<string> copied)
    {
        Directory.CreateDirectory(dest);
        foreach (var entry in Directory.GetFileSystemEntries(src))
        {
            var name = Path.GetFileName(entry);
            if (name.StartsWith('.')) continue;
            var destPath = Path.Combine(dest, name);
            if (Directory.Exists(entry))
                CopyRecursive(entry, destPath, copied);
            else
            {
                File.Copy(entry, destPath, overwrite: true);
                copied.Add(destPath.Replace('\\', '/'));
            }
        }
    }

    private static void CollectRelatedPages(string dir, string sourceName, List<string> results)
    {
        var fileName = Path.GetFileName(sourceName).ToLowerInvariant();
        var fileStem = Path.GetFileNameWithoutExtension(sourceName).ToLowerInvariant();

        foreach (var entry in Directory.GetFileSystemEntries(dir))
        {
            if (Directory.Exists(entry)) { CollectRelatedPages(entry, sourceName, results); continue; }
            if (Path.GetExtension(entry) != ".md") continue;

            var fname = Path.GetFileName(entry);
            if (fname is "index.md" or "log.md" or "overview.md") continue;

            var content = File.ReadAllText(entry);
            var contentLower = content.ToLowerInvariant();

            var quotedMatch = contentLower.Contains($"\"{fileName}\"") || contentLower.Contains($"'{fileName}'");
            var isInSourcesDir = entry.Split(Path.DirectorySeparatorChar).Contains("sources");
            var isSourceSummary = isInSourcesDir && fname.ToLowerInvariant().StartsWith(fileStem);
            var frontmatterMatch = CheckFrontmatterSources(content, fileName);

            if (quotedMatch || isSourceSummary || frontmatterMatch)
                results.Add(entry.Replace('\\', '/'));
        }
    }

    private static bool CheckFrontmatterSources(string content, string fileName)
    {
        if (!content.StartsWith("---\n")) return false;
        var fmEnd = content.IndexOf("\n---", 4);
        if (fmEnd < 0) return false;
        var fm = content[4..fmEnd].ToLowerInvariant();
        var inSources = false;
        foreach (var line in fm.Split('\n'))
        {
            if (line.StartsWith("sources:"))
            {
                if (line.Contains(fileName)) return true;
                inSources = true; continue;
            }
            if (inSources)
            {
                if (line.Length == 0 || line[0] == ' ' || line[0] == '\t')
                { if (line.Contains(fileName)) return true; }
                else inSources = false;
            }
        }
        return false;
    }

    private static string CachePath(string original) =>
        Path.Combine(Path.GetDirectoryName(original)!, ".cache", Path.GetFileName(original) + ".txt");

    private static bool TryReadCache(string original, out string? content)
    {
        content = null;
        var cp = CachePath(original);
        if (!File.Exists(cp)) return false;
        var origMod = File.GetLastWriteTimeUtc(original);
        var cacheMod = File.GetLastWriteTimeUtc(cp);
        if (cacheMod < origMod) return false;
        content = File.ReadAllText(cp);
        return true;
    }

    private static void WriteCache(string original, string text)
    {
        var cp = CachePath(original);
        Directory.CreateDirectory(Path.GetDirectoryName(cp)!);
        File.WriteAllText(cp, text);
    }
}
```

- [ ] **Step 5: Add stub services so tests compile**

`llm-wiki-server/src/LlmWiki.Api/Services/PdfExtractService.cs`:

```csharp
namespace LlmWiki.Api.Services;

public class PdfExtractService
{
    public virtual Task<string> ExtractText(string path) =>
        Task.FromResult($"[PDF: {Path.GetFileName(path)}]");
}
```

`llm-wiki-server/src/LlmWiki.Api/Services/OfficeExtractService.cs`:

```csharp
namespace LlmWiki.Api.Services;

public class OfficeExtractService
{
    public virtual Task<string> ExtractText(string path, string ext) =>
        Task.FromResult($"[{ext.ToUpperInvariant()}: {Path.GetFileName(path)}]");
}
```

- [ ] **Step 6: Run tests**

```bash
cd llm-wiki-server && dotnet test --filter FileServiceTests
```

Expected: `Passed! - Failed: 0, Passed: 5`

- [ ] **Step 7: Commit**

```bash
git add llm-wiki-server/
git commit -m "feat(p2): FileService basic ops + tree + copy + find-related"
```

---

### Task 6: FileController

**Files:**
- Create: `llm-wiki-server/src/LlmWiki.Api/Controllers/FileController.cs`

- [ ] **Step 1: Write `FileController.cs`**

`llm-wiki-server/src/LlmWiki.Api/Controllers/FileController.cs`:

```csharp
using LlmWiki.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace LlmWiki.Api.Controllers;

[ApiController]
[Route("api/file")]
public class FileController(FileService fileService) : ControllerBase
{
    [HttpGet("read")]
    public async Task<IActionResult> Read([FromQuery] string path)
    {
        try { return Ok(await fileService.ReadFile(path)); }
        catch (Exception ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpPost("write")]
    public async Task<IActionResult> Write([FromBody] WriteRequest req)
    {
        try { await fileService.WriteFile(req.Path, req.Contents); return Ok(); }
        catch (Exception ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpGet("list")]
    public async Task<IActionResult> List([FromQuery] string path)
    {
        try { return Ok(await fileService.ListDirectory(path)); }
        catch (Exception ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpPost("copy")]
    public async Task<IActionResult> Copy([FromBody] CopyRequest req)
    {
        try { await fileService.CopyFile(req.Source, req.Destination); return Ok(); }
        catch (Exception ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpPost("copy-directory")]
    public async Task<IActionResult> CopyDirectory([FromBody] CopyRequest req)
    {
        try { return Ok(await fileService.CopyDirectory(req.Source, req.Destination)); }
        catch (Exception ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpPost("preprocess")]
    public async Task<IActionResult> Preprocess([FromBody] PathRequest req)
    {
        try { return Ok(await fileService.PreprocessFile(req.Path)); }
        catch (Exception ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpDelete]
    public async Task<IActionResult> Delete([FromQuery] string path)
    {
        try { await fileService.DeleteFile(path); return Ok(); }
        catch (Exception ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpGet("exists")]
    public async Task<IActionResult> Exists([FromQuery] string path) =>
        Ok(await fileService.FileExists(path));

    [HttpGet("base64")]
    public async Task<IActionResult> Base64([FromQuery] string path)
    {
        try
        {
            var (b64, mime) = await fileService.ReadFileAsBase64(path);
            return Ok(new { base64 = b64, mimeType = mime });
        }
        catch (Exception ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpPost("find-related")]
    public async Task<IActionResult> FindRelated([FromBody] FindRelatedRequest req) =>
        Ok(await fileService.FindRelatedWikiPages(req.ProjectPath, req.SourceName));

    [HttpPost("create-directory")]
    public async Task<IActionResult> CreateDirectory([FromBody] PathRequest req)
    {
        try { await fileService.CreateDirectory(req.Path); return Ok(); }
        catch (Exception ex) { return BadRequest(new { error = ex.Message }); }
    }
}

public record WriteRequest(string Path, string Contents);
public record CopyRequest(string Source, string Destination);
public record PathRequest(string Path);
public record FindRelatedRequest(string ProjectPath, string SourceName);
```

- [ ] **Step 2: Update `src/commands/fs.ts` to route all fs commands**

Replace the entire `fs.ts` content:

```typescript
import { invoke } from "@tauri-apps/api/core"
import type { FileNode, WikiProject } from "@/types/wiki"
import { ensureProjectId, upsertProjectInfo } from "@/lib/project-identity"
import { httpGet, httpPost, httpDelete } from "@/api/dotnet-client"

const USE_DOTNET = import.meta.env.VITE_DOTNET_BACKEND === '1'
const enc = encodeURIComponent

export async function readFile(path: string): Promise<string> {
  return USE_DOTNET
    ? httpGet<string>(`/api/file/read?path=${enc(path)}`)
    : invoke<string>("read_file", { path })
}

export async function writeFile(path: string, contents: string): Promise<void> {
  return USE_DOTNET
    ? httpPost<void>('/api/file/write', { path, contents })
    : invoke<void>("write_file", { path, contents })
}

export async function listDirectory(path: string): Promise<FileNode[]> {
  return USE_DOTNET
    ? httpGet<FileNode[]>(`/api/file/list?path=${enc(path)}`)
    : invoke<FileNode[]>("list_directory", { path })
}

export async function copyFile(source: string, destination: string): Promise<void> {
  return USE_DOTNET
    ? httpPost<void>('/api/file/copy', { source, destination })
    : invoke("copy_file", { source, destination })
}

export async function preprocessFile(path: string): Promise<string> {
  return USE_DOTNET
    ? httpPost<string>('/api/file/preprocess', { path })
    : invoke<string>("preprocess_file", { path })
}

export async function deleteFile(path: string): Promise<void> {
  return USE_DOTNET
    ? httpDelete<void>(`/api/file?path=${enc(path)}`)
    : invoke("delete_file", { path })
}

export async function findRelatedWikiPages(projectPath: string, sourceName: string): Promise<string[]> {
  return USE_DOTNET
    ? httpPost<string[]>('/api/file/find-related', { projectPath, sourceName })
    : invoke<string[]>("find_related_wiki_pages", { projectPath, sourceName })
}

export async function createDirectory(path: string): Promise<void> {
  return USE_DOTNET
    ? httpPost<void>('/api/file/create-directory', { path })
    : invoke<void>("create_directory", { path })
}

export async function fileExists(path: string): Promise<boolean> {
  return USE_DOTNET
    ? httpGet<boolean>(`/api/file/exists?path=${enc(path)}`)
    : invoke<boolean>("file_exists", { path })
}

export interface FileBase64 { base64: string; mimeType: string }

export async function readFileAsBase64(path: string): Promise<FileBase64> {
  return USE_DOTNET
    ? httpGet<FileBase64>(`/api/file/base64?path=${enc(path)}`)
    : invoke<FileBase64>("read_file_as_base64", { path })
}

interface RawProject { name: string; path: string }

export async function createProject(name: string, path: string): Promise<WikiProject> {
  const raw = USE_DOTNET
    ? await httpPost<RawProject>('/api/project/create', { name, path })
    : await invoke<RawProject>("create_project", { name, path })
  const id = await ensureProjectId(raw.path)
  await upsertProjectInfo(id, raw.path, raw.name)
  return { id, name: raw.name, path: raw.path }
}

export async function openProject(path: string): Promise<WikiProject> {
  const raw = USE_DOTNET
    ? await httpPost<RawProject>('/api/project/open', { path })
    : await invoke<RawProject>("open_project", { path })
  const id = await ensureProjectId(raw.path)
  await upsertProjectInfo(id, raw.path, raw.name)
  return { id, name: raw.name, path: raw.path }
}

export async function clipServerStatus(): Promise<string> {
  return USE_DOTNET
    ? httpGet<string>('/api/status/clip')
    : invoke<string>("clip_server_status")
}
```

- [ ] **Step 3: Verify frontend build**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add llm-wiki-server/src/LlmWiki.Api/Controllers/FileController.cs
git add src/commands/fs.ts
git commit -m "feat(p2): FileController + full fs routing in frontend"
```

---

## Phase P3: Claude CLI + WebSocket

### Task 7: ClaudeCliService + detect endpoint

**Files:**
- Create: `llm-wiki-server/src/LlmWiki.Api/Services/ClaudeCliService.cs`
- Create: `llm-wiki-server/src/LlmWiki.Api/Controllers/ClaudeController.cs`

- [ ] **Step 1: Write `ClaudeCliService.cs`**

`llm-wiki-server/src/LlmWiki.Api/Services/ClaudeCliService.cs`:

```csharp
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text.Json;

namespace LlmWiki.Api.Services;

public record DetectResult(bool Installed, string? Version, string? Path, string? Error);

public record ClaudeMessage(string Role, string Content);

public class ClaudeCliService
{
    private readonly ConcurrentDictionary<string, Process> _processes = new();

    public async Task<DetectResult> Detect()
    {
        var claudePath = FindClaude();
        if (claudePath is null)
            return new DetectResult(false, null, null, "`claude` not found on PATH");

        try
        {
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(3));
            var psi = new ProcessStartInfo(claudePath, "--version")
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false
            };
            using var proc = Process.Start(psi)!;
            await proc.WaitForExitAsync(cts.Token);
            if (proc.ExitCode == 0)
            {
                var version = (await proc.StandardOutput.ReadToEndAsync()).Trim();
                return new DetectResult(true, version, claudePath, null);
            }
            var stderr = (await proc.StandardError.ReadToEndAsync()).Trim();
            return new DetectResult(false, null, claudePath, stderr.Length > 0 ? stderr : $"`claude --version` exited with {proc.ExitCode}");
        }
        catch (OperationCanceledException)
        {
            return new DetectResult(false, null, claudePath, "`claude --version` timed out after 3s");
        }
        catch (Exception ex)
        {
            return new DetectResult(false, null, claudePath, $"Failed to spawn `claude`: {ex.Message}");
        }
    }

    public async Task Spawn(
        string streamId,
        string model,
        IReadOnlyList<ClaudeMessage> messages,
        Func<string, Task> onLine,
        Func<int?, string, Task> onDone)
    {
        var claudePath = FindClaude() ?? throw new InvalidOperationException("`claude` not found on PATH");

        var systemPreamble = string.Join("\n\n", messages.Where(m => m.Role == "system").Select(m => m.Content));
        var conversation = messages.Where(m => m.Role is "user" or "assistant").ToList();
        if (conversation.Count == 0) throw new InvalidOperationException("No user/assistant messages");

        var psi = new ProcessStartInfo(claudePath)
        {
            UseShellExecute = false,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        psi.ArgumentList.Add("-p");
        psi.ArgumentList.Add("--output-format"); psi.ArgumentList.Add("stream-json");
        psi.ArgumentList.Add("--input-format"); psi.ArgumentList.Add("stream-json");
        psi.ArgumentList.Add("--verbose");
        psi.ArgumentList.Add("--model"); psi.ArgumentList.Add(model);

        var proc = Process.Start(psi)!;
        _processes[streamId] = proc;

        // Write conversation to stdin
        bool firstUser = true;
        foreach (var msg in conversation)
        {
            var content = msg.Content;
            if (firstUser && msg.Role == "user" && systemPreamble.Length > 0)
            { content = $"{systemPreamble}\n\n{content}"; firstUser = false; }

            var evt = JsonSerializer.Serialize(new
            {
                type = msg.Role,
                message = new { role = msg.Role, content = new[] { new { type = "text", text = content } } }
            });
            await proc.StandardInput.WriteLineAsync(evt);
        }
        await proc.StandardInput.FlushAsync();
        proc.StandardInput.Close();

        // Drain stdout
        var stderrTask = proc.StandardError.ReadToEndAsync();
        string? line;
        while ((line = await proc.StandardOutput.ReadLineAsync()) != null)
            await onLine(line);

        await proc.WaitForExitAsync();
        var stderr = (await stderrTask).Trim();
        _processes.TryRemove(streamId, out _);
        await onDone(proc.ExitCode, stderr);
    }

    public void Kill(string streamId)
    {
        if (_processes.TryRemove(streamId, out var proc))
            try { proc.Kill(); } catch { /* already exited */ }
    }

    private static string? FindClaude()
    {
        var candidates = OperatingSystem.IsWindows()
            ? new[] { "claude.cmd", "claude.exe", "claude" }
            : new[] { "claude" };

        foreach (var name in candidates)
        {
            var path = FindOnPath(name);
            if (path is not null) return path;
        }
        return null;
    }

    private static string? FindOnPath(string name)
    {
        var pathEnv = Environment.GetEnvironmentVariable("PATH") ?? "";
        var ext = OperatingSystem.IsWindows() && !name.Contains('.') ? ".exe" : "";
        return pathEnv.Split(Path.PathSeparator)
            .Select(dir => Path.Combine(dir, name + ext))
            .FirstOrDefault(File.Exists);
    }
}
```

- [ ] **Step 2: Write `ClaudeController.cs`**

`llm-wiki-server/src/LlmWiki.Api/Controllers/ClaudeController.cs`:

```csharp
using LlmWiki.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace LlmWiki.Api.Controllers;

[ApiController]
[Route("api/claude")]
public class ClaudeController(ClaudeCliService claudeCliService) : ControllerBase
{
    [HttpGet("detect")]
    public async Task<IActionResult> Detect() =>
        Ok(await claudeCliService.Detect());
}
```

- [ ] **Step 3: Verify build**

```bash
cd llm-wiki-server && dotnet build
```

Expected: `Build succeeded. 0 Error(s)`

- [ ] **Step 4: Commit**

```bash
git add llm-wiki-server/src/LlmWiki.Api/Services/ClaudeCliService.cs
git add llm-wiki-server/src/LlmWiki.Api/Controllers/ClaudeController.cs
git commit -m "feat(p3): ClaudeCliService + detect endpoint"
```

---

### Task 8: WebSocket hub for claude streaming

**Files:**
- Create: `llm-wiki-server/src/LlmWiki.Api/Hubs/ClaudeWebSocket.cs`

- [ ] **Step 1: Write `ClaudeWebSocket.cs`**

`llm-wiki-server/src/LlmWiki.Api/Hubs/ClaudeWebSocket.cs`:

```csharp
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using LlmWiki.Api.Services;

namespace LlmWiki.Api.Hubs;

public class ClaudeWebSocket(ClaudeCliService claudeCliService)
{
    public async Task Handle(WebSocket ws)
    {
        var buffer = new byte[1024 * 64];
        while (ws.State == WebSocketState.Open)
        {
            var result = await ws.ReceiveAsync(buffer, CancellationToken.None);
            if (result.MessageType == WebSocketMessageType.Close) break;

            var json = Encoding.UTF8.GetString(buffer, 0, result.Count);
            JsonElement msg;
            try { msg = JsonDocument.Parse(json).RootElement; }
            catch { continue; }

            var type = msg.TryGetProperty("type", out var t) ? t.GetString() : null;
            var streamId = msg.TryGetProperty("streamId", out var s) ? s.GetString() ?? "" : "";

            if (type == "spawn")
            {
                var model = msg.GetProperty("model").GetString() ?? "claude-opus-4-6";
                var messages = msg.GetProperty("messages").Deserialize<List<ClaudeMessage>>() ?? [];

                _ = Task.Run(async () =>
                {
                    try
                    {
                        await claudeCliService.Spawn(
                            streamId, model, messages,
                            onLine: async line => await SendJson(ws, new { type = "line", streamId, payload = line }),
                            onDone: async (code, stderr) => await SendJson(ws, new { type = "done", streamId, code, stderr })
                        );
                    }
                    catch (Exception ex)
                    {
                        await SendJson(ws, new { type = "error", streamId, message = ex.Message });
                    }
                });
            }
            else if (type == "kill")
            {
                claudeCliService.Kill(streamId);
            }
        }
    }

    private static async Task SendJson(WebSocket ws, object payload)
    {
        if (ws.State != WebSocketState.Open) return;
        var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(payload));
        await ws.SendAsync(bytes, WebSocketMessageType.Text, endOfMessage: true, CancellationToken.None);
    }
}
```

- [ ] **Step 2: Register WebSocket route in `Program.cs`**

Add after `app.MapControllers()` in `Program.cs`:

```csharp
app.Map("/ws/claude", async context =>
{
    if (!context.WebSockets.IsWebSocketRequest) { context.Response.StatusCode = 400; return; }
    var ws = await context.WebSockets.AcceptWebSocketAsync();
    var hub = context.RequestServices.GetRequiredService<ClaudeWebSocket>();
    await hub.Handle(ws);
});
```

Also register `ClaudeWebSocket` as a service in `Program.cs` alongside the others:

```csharp
builder.Services.AddScoped<ClaudeWebSocket>();
```

- [ ] **Step 3: Update `src/lib/claude-cli-transport.ts` to support WebSocket**

Add the WebSocket implementation before the existing Tauri implementation:

```typescript
const USE_DOTNET = import.meta.env.VITE_DOTNET_BACKEND === '1'
const DOTNET_WS_URL = (import.meta.env.VITE_DOTNET_URL ?? 'http://localhost:5200')
  .replace('http://', 'ws://')
  .replace('https://', 'wss://')

export async function streamClaudeCodeCli(
  config: LlmConfig,
  messages: ChatMessage[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
  overrides?: RequestOverrides,
): Promise<void> {
  if (USE_DOTNET) {
    return streamClaudeCodeCliDotnet(config, messages, callbacks, signal)
  }
  return streamClaudeCodeCliTauri(config, messages, callbacks, signal, overrides)
}

async function streamClaudeCodeCliDotnet(
  config: LlmConfig,
  messages: ChatMessage[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const { onToken, onDone, onError } = callbacks
  const streamId = crypto.randomUUID()
  const parse = createClaudeCodeStreamParser()

  const ws = new WebSocket(`${DOTNET_WS_URL}/ws/claude`)
  let finished = false

  const finish = (cb: () => void) => {
    if (finished) return
    finished = true
    ws.close()
    cb()
  }

  signal?.addEventListener('abort', () => {
    ws.send(JSON.stringify({ type: 'kill', streamId }))
    finish(onDone)
  })

  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'spawn', streamId, model: config.model, messages }))
      resolve()
    }
    ws.onerror = () => reject(new Error('WebSocket connection failed'))
  })

  await new Promise<void>((resolve) => {
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data as string)
      if (msg.streamId !== streamId) return
      if (msg.type === 'line') {
        const token = parse(msg.payload)
        if (token !== null) onToken(token)
      } else if (msg.type === 'done') {
        const code = msg.code
        const stderr = msg.stderr ?? ''
        if (code !== null && code !== 0) {
          finish(() => onError(new Error(buildExitError(code, stderr))))
        } else {
          finish(onDone)
        }
        resolve()
      } else if (msg.type === 'error') {
        finish(() => onError(new Error(msg.message)))
        resolve()
      }
    }
    ws.onclose = () => { finish(onDone); resolve() }
  })
}

// Rename the existing implementation
async function streamClaudeCodeCliTauri(
  config: LlmConfig,
  messages: ChatMessage[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
  overrides?: RequestOverrides,
): Promise<void> {
  // ... existing Tauri implementation unchanged (just renamed) ...
}
```

- [ ] **Step 4: Verify frontend typecheck**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add llm-wiki-server/src/LlmWiki.Api/Hubs/ClaudeWebSocket.cs
git add llm-wiki-server/src/LlmWiki.Api/Program.cs
git add src/lib/claude-cli-transport.ts
git commit -m "feat(p3): WebSocket hub for claude CLI streaming"
```

---

## Phase P4: Image Extraction

### Task 9: PDF + Office image extraction

**Files:**
- Modify: `llm-wiki-server/src/LlmWiki.Api/Services/PdfExtractService.cs`
- Modify: `llm-wiki-server/src/LlmWiki.Api/Services/OfficeExtractService.cs`
- Create: `llm-wiki-server/src/LlmWiki.Api/Controllers/ExtractController.cs`

- [ ] **Step 1: Implement `PdfExtractService.cs` with PdfPig**

Replace the stub in `PdfExtractService.cs`:

```csharp
using UglyToad.PdfPig;
using UglyToad.PdfPig.Content;

namespace LlmWiki.Api.Services;

public class PdfExtractService
{
    public virtual Task<string> ExtractText(string path)
    {
        try
        {
            using var doc = PdfDocument.Open(path);
            var sb = new System.Text.StringBuilder();
            foreach (var page in doc.GetPages())
            {
                sb.AppendLine($"## Page {page.Number}");
                sb.AppendLine();
                sb.AppendLine(string.Join(" ", page.GetWords().Select(w => w.Text)));
                sb.AppendLine();
            }
            return Task.FromResult(sb.ToString());
        }
        catch (Exception ex)
        {
            return Task.FromResult($"[PDF extraction failed: {ex.Message}]");
        }
    }

    public Task<List<(int PageNumber, byte[] ImageBytes, string Format)>> ExtractImages(string path)
    {
        var images = new List<(int, byte[], string)>();
        try
        {
            using var doc = PdfDocument.Open(path);
            foreach (var page in doc.GetPages())
            foreach (var img in page.GetImages())
            {
                if (img.TryGetPng(out var png))
                    images.Add((page.Number, png, "png"));
            }
        }
        catch { /* return what we have */ }
        return Task.FromResult(images);
    }
}
```

- [ ] **Step 2: Implement `OfficeExtractService.cs`**

Replace the stub in `OfficeExtractService.cs`:

```csharp
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;
using ClosedXML.Excel;

namespace LlmWiki.Api.Services;

public class OfficeExtractService
{
    public virtual Task<string> ExtractText(string path, string ext) =>
        Task.FromResult(ext switch
        {
            "docx" => ExtractDocx(path),
            "pptx" => ExtractPptx(path),
            "xlsx" or "xls" or "ods" => ExtractSpreadsheet(path),
            _ => $"[Unsupported: .{ext}]"
        });

    private static string ExtractDocx(string path)
    {
        try
        {
            using var doc = WordprocessingDocument.Open(path, false);
            var body = doc.MainDocumentPart?.Document?.Body;
            if (body is null) return "[Could not read DOCX]";
            var sb = new System.Text.StringBuilder();
            foreach (var para in body.Elements<Paragraph>())
            {
                var text = para.InnerText.Trim();
                if (text.Length == 0) continue;
                var styleId = para.ParagraphProperties?.ParagraphStyleId?.Val?.Value ?? "";
                if (styleId.StartsWith("Heading", StringComparison.OrdinalIgnoreCase) &&
                    int.TryParse(styleId.AsSpan(styleId.Length - 1), out var level))
                    sb.AppendLine($"{new string('#', level)} {text}");
                else
                    sb.AppendLine(text);
                sb.AppendLine();
            }
            return sb.ToString();
        }
        catch (Exception ex) { return $"[DOCX extraction failed: {ex.Message}]"; }
    }

    private static string ExtractPptx(string path)
    {
        try
        {
            using var prs = PresentationDocument.Open(path, false);
            var sb = new System.Text.StringBuilder();
            var slides = prs.PresentationPart?.SlideParts?.ToList() ?? [];
            for (var i = 0; i < slides.Count; i++)
            {
                sb.AppendLine($"## Slide {i + 1}");
                var texts = slides[i].Slide.Descendants<DocumentFormat.OpenXml.Drawing.Text>()
                    .Select(t => t.Text.Trim()).Where(t => t.Length > 0);
                foreach (var t in texts) sb.AppendLine($"- {t}");
                sb.AppendLine();
            }
            return sb.ToString();
        }
        catch (Exception ex) { return $"[PPTX extraction failed: {ex.Message}]"; }
    }

    private static string ExtractSpreadsheet(string path)
    {
        try
        {
            using var wb = new XLWorkbook(path);
            var sb = new System.Text.StringBuilder();
            foreach (var ws in wb.Worksheets)
            {
                if (wb.Worksheets.Count() > 1) sb.AppendLine($"## {ws.Name}");
                var rows = ws.RangeUsed()?.RowsUsed().ToList();
                if (rows is null || rows.Count == 0) continue;
                for (var r = 0; r < rows.Count; r++)
                {
                    var cells = rows[r].Cells().Select(c => c.GetString().Replace("|", "\\|"));
                    sb.Append("| ").Append(string.Join(" | ", cells)).AppendLine(" |");
                    if (r == 0)
                    {
                        var cols = rows[r].Cells().Count();
                        sb.Append('|').Append(string.Concat(Enumerable.Repeat(" --- |", cols))).AppendLine();
                    }
                }
                sb.AppendLine();
            }
            return sb.ToString();
        }
        catch (Exception ex) { return $"[Spreadsheet extraction failed: {ex.Message}]"; }
    }
}
```

- [ ] **Step 3: Write `ExtractController.cs`**

`llm-wiki-server/src/LlmWiki.Api/Controllers/ExtractController.cs`:

```csharp
using LlmWiki.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace LlmWiki.Api.Controllers;

public record ExtractRequest(string Path);
public record ExtractSaveRequest(string Path, string DestDir, string UrlPrefix);

[ApiController]
[Route("api/extract")]
public class ExtractController(PdfExtractService pdfExtract, OfficeExtractService officeExtract) : ControllerBase
{
    [HttpPost("pdf-images")]
    public async Task<IActionResult> PdfImages([FromBody] ExtractRequest req)
    {
        try
        {
            var images = await pdfExtract.ExtractImages(req.Path);
            return Ok(images.Select(i => new { page = i.PageNumber, format = i.Format }));
        }
        catch (Exception ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpPost("office-images")]
    public IActionResult OfficeImages([FromBody] ExtractRequest req) =>
        Ok(Array.Empty<object>()); // Office image extraction stubbed — add if needed

    [HttpPost("pdf-images/save")]
    public async Task<IActionResult> PdfImagesSave([FromBody] ExtractSaveRequest req)
    {
        try
        {
            var images = await pdfExtract.ExtractImages(req.Path);
            Directory.CreateDirectory(req.DestDir);
            var saved = new List<string>();
            foreach (var (page, bytes, fmt) in images)
            {
                var file = Path.Combine(req.DestDir, $"page-{page}.{fmt}");
                await System.IO.File.WriteAllBytesAsync(file, bytes);
                saved.Add(file.Replace('\\', '/'));
            }
            return Ok(saved);
        }
        catch (Exception ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpPost("office-images/save")]
    public IActionResult OfficeImagesSave([FromBody] ExtractSaveRequest req) =>
        Ok(Array.Empty<string>());
}
```

- [ ] **Step 4: Verify build**

```bash
cd llm-wiki-server && dotnet build
```

Expected: `Build succeeded. 0 Error(s)`

- [ ] **Step 5: Commit**

```bash
git add llm-wiki-server/src/LlmWiki.Api/Services/PdfExtractService.cs
git add llm-wiki-server/src/LlmWiki.Api/Services/OfficeExtractService.cs
git add llm-wiki-server/src/LlmWiki.Api/Controllers/ExtractController.cs
git commit -m "feat(p4): PDF/Office text extraction + image extract endpoints"
```

---

## Phase P5: Qdrant Vector Store

### Task 10: VectorService + VectorController

**Files:**
- Create: `llm-wiki-server/src/LlmWiki.Api/Models/VectorModels.cs`
- Create: `llm-wiki-server/src/LlmWiki.Api/Services/VectorService.cs`
- Create: `llm-wiki-server/src/LlmWiki.Api/Controllers/VectorController.cs`
- Create: `llm-wiki-server/tests/LlmWiki.Api.Tests/VectorServiceTests.cs`

- [ ] **Step 1: Write `VectorModels.cs`**

`llm-wiki-server/src/LlmWiki.Api/Models/VectorModels.cs`:

```csharp
namespace LlmWiki.Api.Models;

public record VectorSearchResult(string PageId, float Score);

public record ChunkSearchResult(
    string ChunkId, string PageId, uint ChunkIndex,
    string ChunkText, string HeadingPath, float Score);

public record ChunkUpsertInput(
    uint ChunkIndex, string ChunkText, string HeadingPath, float[] Embedding);

public record VectorUpsertRequest(string ProjectPath, string PageId, float[] Embedding);
public record VectorSearchRequest(string ProjectPath, float[] QueryEmbedding, int TopK);
public record VectorDeleteRequest(string ProjectPath, string PageId);
public record VectorCountRequest(string ProjectPath);
public record ChunkUpsertRequest(string ProjectPath, string PageId, ChunkUpsertInput[] Chunks);
public record ChunkSearchRequest(string ProjectPath, float[] QueryEmbedding, int TopK);
public record ChunkDeleteRequest(string ProjectPath, string PageId);
```

- [ ] **Step 2: Write failing tests**

`llm-wiki-server/tests/LlmWiki.Api.Tests/VectorServiceTests.cs`:

```csharp
using LlmWiki.Api.Models;
using LlmWiki.Api.Services;
using Microsoft.Extensions.Configuration;

namespace LlmWiki.Api.Tests;

// NOTE: These tests require a running Qdrant instance on localhost:6334.
// Start Qdrant with: docker run -p 6334:6334 qdrant/qdrant
// Skip in CI if Qdrant is unavailable.
[Trait("Category", "Integration")]
public class VectorServiceTests : IAsyncLifetime
{
    private readonly VectorService _sut;
    private readonly string _projectPath = $"/tmp/vstest-{Guid.NewGuid():N}";

    public VectorServiceTests()
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Qdrant:Host"] = "localhost",
                ["Qdrant:Port"] = "6334",
            })
            .Build();
        _sut = new VectorService(config);
    }

    public Task InitializeAsync() => Task.CompletedTask;
    public async Task DisposeAsync() => await _sut.DropCollection(_projectPath);

    [Fact]
    public async Task UpsertChunks_ThenCount_ReturnsChunkCount()
    {
        var chunks = MakeChunks("page-a", 3, 16);
        await _sut.UpsertChunks(_projectPath, "page-a", chunks);
        Assert.Equal(3, await _sut.CountChunks(_projectPath));
    }

    [Fact]
    public async Task UpsertChunks_ReplacesExisting()
    {
        await _sut.UpsertChunks(_projectPath, "page-a", MakeChunks("page-a", 5, 16));
        await _sut.UpsertChunks(_projectPath, "page-a", MakeChunks("page-a", 2, 16));
        Assert.Equal(2, await _sut.CountChunks(_projectPath));
    }

    [Fact]
    public async Task SearchChunks_ReturnsResults()
    {
        await _sut.UpsertChunks(_projectPath, "page-a", MakeChunks("page-a", 3, 16));
        var results = await _sut.SearchChunks(_projectPath, FakeEmbedding(1, 16), 10);
        Assert.NotEmpty(results);
        Assert.All(results, r => Assert.Equal("page-a", r.PageId));
    }

    [Fact]
    public async Task DeletePage_RemovesOnlyItsChunks()
    {
        await _sut.UpsertChunks(_projectPath, "page-a", MakeChunks("page-a", 3, 16));
        await _sut.UpsertChunks(_projectPath, "page-b", MakeChunks("page-b", 2, 16));
        await _sut.DeletePage(_projectPath, "page-a");
        Assert.Equal(2, await _sut.CountChunks(_projectPath));
    }

    private static ChunkUpsertInput[] MakeChunks(string pageId, int n, int dim) =>
        Enumerable.Range(0, n).Select(i =>
            new ChunkUpsertInput((uint)i, $"{pageId} chunk {i}", $"## Heading {i}", FakeEmbedding((uint)i, dim))
        ).ToArray();

    private static float[] FakeEmbedding(uint seed, int dim) =>
        Enumerable.Range(0, dim).Select(i =>
            MathF.Sin(((float)((seed * 2654435761u) ^ (uint)i)) / uint.MaxValue)
        ).ToArray();
}
```

- [ ] **Step 3: Run to verify failure**

```bash
cd llm-wiki-server && dotnet test --filter VectorServiceTests
```

Expected: FAIL — `VectorService does not exist`

- [ ] **Step 4: Write `VectorService.cs`**

`llm-wiki-server/src/LlmWiki.Api/Services/VectorService.cs`:

```csharp
using LlmWiki.Api.Models;
using Microsoft.Extensions.Configuration;
using Qdrant.Client;
using Qdrant.Client.Grpc;

namespace LlmWiki.Api.Services;

public class VectorService
{
    private readonly QdrantClient _client;

    public VectorService(IConfiguration config)
    {
        var host = config["Qdrant:Host"] ?? "localhost";
        var port = config.GetValue<int>("Qdrant:Port", 6334);
        _client = new QdrantClient(host, port);
    }

    private static string CollectionName(string projectPath)
    {
        var hash = Math.Abs(projectPath.GetHashCode()).ToString("x8");
        return $"llmwiki_{hash}";
    }

    private async Task EnsureCollection(string projectPath, uint dim)
    {
        var name = CollectionName(projectPath);
        var existing = await _client.ListCollectionsAsync();
        if (existing.Any(c => c == name)) return;
        await _client.CreateCollectionAsync(name, new VectorParams { Size = dim, Distance = Distance.Cosine });
    }

    public async Task UpsertChunks(string projectPath, string pageId, ChunkUpsertInput[] chunks)
    {
        if (chunks.Length == 0) return;
        ValidatePageId(pageId);
        var dim = (uint)chunks[0].Embedding.Length;
        await EnsureCollection(projectPath, dim);
        var name = CollectionName(projectPath);

        // Delete existing chunks for this page
        await _client.DeleteAsync(name, new Filter
        {
            Must = { new Condition { Field = new FieldCondition { Key = "page_id", Match = new Match { Text = pageId } } } }
        });

        var points = chunks.Select((c, idx) => new PointStruct
        {
            Id = new PointId { Uuid = Guid.NewGuid().ToString() },
            Vectors = new Vectors { Vector = new Vector { Data = { c.Embedding } } },
            Payload =
            {
                ["chunk_id"] = $"{pageId}#{c.ChunkIndex}",
                ["page_id"] = pageId,
                ["chunk_index"] = (long)c.ChunkIndex,
                ["chunk_text"] = c.ChunkText,
                ["heading_path"] = c.HeadingPath,
            }
        }).ToList();

        await _client.UpsertAsync(name, points);
    }

    public async Task<List<ChunkSearchResult>> SearchChunks(string projectPath, float[] queryEmbedding, int topK)
    {
        var name = CollectionName(projectPath);
        var existing = await _client.ListCollectionsAsync();
        if (!existing.Any(c => c == name)) return [];

        var results = await _client.SearchAsync(name, queryEmbedding, limit: (ulong)topK, payloadSelector: true);
        return results.Select(r => new ChunkSearchResult(
            r.Payload["chunk_id"].StringValue,
            r.Payload["page_id"].StringValue,
            (uint)r.Payload["chunk_index"].IntegerValue,
            r.Payload["chunk_text"].StringValue,
            r.Payload["heading_path"].StringValue,
            1f / (1f + (1f - r.Score))
        )).ToList();
    }

    public async Task DeletePage(string projectPath, string pageId)
    {
        ValidatePageId(pageId);
        var name = CollectionName(projectPath);
        var existing = await _client.ListCollectionsAsync();
        if (!existing.Any(c => c == name)) return;
        await _client.DeleteAsync(name, new Filter
        {
            Must = { new Condition { Field = new FieldCondition { Key = "page_id", Match = new Match { Text = pageId } } } }
        });
    }

    public async Task<ulong> CountChunks(string projectPath)
    {
        var name = CollectionName(projectPath);
        var existing = await _client.ListCollectionsAsync();
        if (!existing.Any(c => c == name)) return 0;
        var info = await _client.GetCollectionInfoAsync(name);
        return info.PointsCount ?? 0;
    }

    public async Task DropCollection(string projectPath)
    {
        var name = CollectionName(projectPath);
        var existing = await _client.ListCollectionsAsync();
        if (existing.Any(c => c == name))
            await _client.DeleteCollectionAsync(name);
    }

    // Legacy v1 stubs — return no-ops for frontend compatibility
    public Task UpsertLegacy(string projectPath, string pageId, float[] embedding) => Task.CompletedTask;
    public Task<List<VectorSearchResult>> SearchLegacy(string projectPath, float[] queryEmbedding, int topK) =>
        Task.FromResult(new List<VectorSearchResult>());
    public Task DeleteLegacy(string projectPath, string pageId) => Task.CompletedTask;
    public Task<ulong> CountLegacy(string projectPath) => Task.FromResult(0UL);
    public Task<ulong> LegacyRowCount(string projectPath) => Task.FromResult(0UL);
    public Task DropLegacy(string projectPath) => Task.CompletedTask;

    private static void ValidatePageId(string pageId)
    {
        if (string.IsNullOrEmpty(pageId) || pageId.Length > 256)
            throw new ArgumentException("Invalid page_id: empty or too long");
        if (!pageId.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_' or '.'))
            throw new ArgumentException($"Invalid page_id: contains disallowed characters: {pageId}");
    }
}
```

- [ ] **Step 5: Write `VectorController.cs`**

`llm-wiki-server/src/LlmWiki.Api/Controllers/VectorController.cs`:

```csharp
using LlmWiki.Api.Models;
using LlmWiki.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace LlmWiki.Api.Controllers;

[ApiController]
[Route("api/vector")]
public class VectorController(VectorService vectorService) : ControllerBase
{
    // v2 chunk endpoints
    [HttpPost("chunks/upsert")]
    public async Task<IActionResult> UpsertChunks([FromBody] ChunkUpsertRequest req)
    {
        try { await vectorService.UpsertChunks(req.ProjectPath, req.PageId, req.Chunks); return Ok(); }
        catch (Exception ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpPost("chunks/search")]
    public async Task<IActionResult> SearchChunks([FromBody] ChunkSearchRequest req) =>
        Ok(await vectorService.SearchChunks(req.ProjectPath, req.QueryEmbedding, req.TopK));

    [HttpDelete("chunks/{pageId}")]
    public async Task<IActionResult> DeletePage(string pageId, [FromQuery] string projectPath)
    {
        try { await vectorService.DeletePage(projectPath, pageId); return Ok(); }
        catch (Exception ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpGet("chunks/count")]
    public async Task<IActionResult> CountChunks([FromQuery] string projectPath) =>
        Ok(await vectorService.CountChunks(projectPath));

    // v1 legacy stubs (frontend may still call these during transition)
    [HttpPost("upsert")]
    public Task<IActionResult> Upsert([FromBody] VectorUpsertRequest req) =>
        Task.FromResult<IActionResult>(Ok());

    [HttpPost("search")]
    public Task<IActionResult> Search([FromBody] VectorSearchRequest req) =>
        Task.FromResult<IActionResult>(Ok(Array.Empty<VectorSearchResult>()));

    [HttpDelete("{pageId}")]
    public Task<IActionResult> Delete(string pageId) =>
        Task.FromResult<IActionResult>(Ok());

    [HttpGet("count")]
    public Task<IActionResult> Count([FromQuery] string projectPath) =>
        Task.FromResult<IActionResult>(Ok(0));

    [HttpGet("legacy/count")]
    public Task<IActionResult> LegacyCount([FromQuery] string projectPath) =>
        Task.FromResult<IActionResult>(Ok(0));

    [HttpDelete("legacy")]
    public Task<IActionResult> DropLegacy([FromQuery] string projectPath) =>
        Task.FromResult<IActionResult>(Ok());
}
```

- [ ] **Step 6: Run integration tests (requires Qdrant)**

```bash
# Start Qdrant first
docker run -d -p 6334:6334 qdrant/qdrant

cd llm-wiki-server
dotnet test --filter "Category=Integration"
```

Expected: `Passed! - Failed: 0, Passed: 4`

- [ ] **Step 7: Update `src/lib/embedding.ts` to route vector calls to .NET**

At the top of `embedding.ts`, add routing for all `invoke` vector calls:

```typescript
import { httpPost, httpGet, httpDelete } from '@/api/dotnet-client'
const USE_DOTNET = import.meta.env.VITE_DOTNET_BACKEND === '1'

// Replace each invoke call with a conditional:
// vector_upsert_chunks → POST /api/vector/chunks/upsert
// vector_search_chunks → POST /api/vector/chunks/search
// vector_delete_page   → DELETE /api/vector/chunks/{pageId}?projectPath=...
// vector_count_chunks  → GET /api/vector/chunks/count?projectPath=...
// vector_legacy_row_count → GET /api/vector/legacy/count?projectPath=...
// vector_drop_legacy      → DELETE /api/vector/legacy?projectPath=...
```

Find each `invoke("vector_*"` call in `embedding.ts` and wrap with:

```typescript
// Example for vector_upsert_chunks:
const result = USE_DOTNET
  ? await httpPost('/api/vector/chunks/upsert', { projectPath, pageId, chunks })
  : await invoke('vector_upsert_chunks', { projectPath, pageId, chunks })
```

- [ ] **Step 8: Verify typecheck**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 9: Commit**

```bash
git add llm-wiki-server/src/LlmWiki.Api/Models/VectorModels.cs
git add llm-wiki-server/src/LlmWiki.Api/Services/VectorService.cs
git add llm-wiki-server/src/LlmWiki.Api/Controllers/VectorController.cs
git add llm-wiki-server/tests/LlmWiki.Api.Tests/VectorServiceTests.cs
git add src/lib/embedding.ts
git commit -m "feat(p5): Qdrant vector store + VectorController + frontend routing"
```

---

## Phase P6: Cleanup

### Task 11: Remove Tauri fallback and Rust code

**Files:**
- Modify: `src/commands/fs.ts`
- Modify: `src/lib/claude-cli-transport.ts`
- Modify: `src/lib/embedding.ts`
- Delete: `src-tauri/`

- [ ] **Step 1: Set `VITE_DOTNET_BACKEND=1` permanently**

In `.env` (create if missing) at repo root:

```
VITE_DOTNET_BACKEND=1
```

- [ ] **Step 2: Remove `USE_DOTNET` conditionals from `src/commands/fs.ts`**

Remove the `USE_DOTNET` constant and all `if (USE_DOTNET)` branches. Keep only the HTTP implementation. Example for `readFile`:

```typescript
export async function readFile(path: string): Promise<string> {
  return httpGet<string>(`/api/file/read?path=${enc(path)}`)
}
```

Repeat for all 13 functions in the file.

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 4: Remove Tauri fallback from `claude-cli-transport.ts`**

Delete `streamClaudeCodeCliTauri` function. Rename `streamClaudeCodeCliDotnet` back to `streamClaudeCodeCli`. Remove all `import { invoke }` and `import { listen }` from `@tauri-apps/api`.

- [ ] **Step 5: Remove Tauri fallback from `embedding.ts`**

Remove all `invoke` calls and `USE_DOTNET` checks. Keep only HTTP calls.

- [ ] **Step 6: Run full test suite**

```bash
npm run test:mocks
```

Expected: all tests pass (Tauri mocks may need updating — remove mock for `invoke` if tests fail)

- [ ] **Step 7: Commit frontend cleanup**

```bash
git add src/
git commit -m "feat(p6): remove Tauri invoke fallback — all calls route to .NET"
```

- [ ] **Step 8: Delete `src-tauri/`**

```bash
# Confirm .NET backend is working first by running the app
git rm -r src-tauri/
```

- [ ] **Step 9: Remove Tauri dependencies from `package.json`**

Remove from `dependencies`:
- `@tauri-apps/api`
- `@tauri-apps/plugin-dialog`
- `@tauri-apps/plugin-http`
- `@tauri-apps/plugin-opener`
- `@tauri-apps/plugin-store`

Remove from `devDependencies`:
- `@tauri-apps/cli`

Then:

```bash
npm install
npm run typecheck
```

Expected: no errors

- [ ] **Step 10: Final commit**

```bash
git add package.json package-lock.json
git commit -m "feat(p6): remove src-tauri and Tauri npm dependencies"
```

---

## Running the full stack

```bash
# Terminal 1: Start Qdrant
docker run -p 6334:6334 qdrant/qdrant

# Terminal 2: Start .NET backend
cd llm-wiki-server && dotnet run --project src/LlmWiki.Api

# Terminal 3: Start React frontend
cd .. && npm run dev
```

Open `http://localhost:1420` (Vite dev port). The app should work exactly as before, now backed by .NET instead of Rust.
