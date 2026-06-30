# Phase 2: Multi-Instance, Gemini Provider, Vector Embedding - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add horizontal scaling (PostgreSQL SKIP LOCKED atomic claim), Google Gemini LLM provider, and server-side vector embedding for ingested wiki pages.

**Architecture:** Three independent subsystems built on the Phase 1 ingest pipeline. Multi-instance: replace the "read then claim" race with a single `UPDATE … FOR UPDATE SKIP LOCKED … RETURNING *` per-worker claim plus startup recovery scoped to own InstanceId. Gemini: add a third branch to `LlmHttpClient`. Embedding: new `EmbeddingConfig` entity, `EmbeddingHttpClient`, `TextChunker`, and a post-write step in `IngestPipelineService` that skips gracefully when unconfigured.

**Tech Stack:** ASP.NET Core 8, EF Core + Npgsql, PostgreSQL, Qdrant (via existing `VectorService`), xUnit, `dotnet ef` CLI.

---

## File Map

### Multi-Instance (Tasks 1–3)
- Modify: `llm-wiki-server/src/LlmWiki.Api/Modules/Wiki/Entities/IngestTask.cs` — add `LockedBy` property
- Run: `dotnet ef migrations add AddLockedByToIngestTask` — generates migration
- Modify: `llm-wiki-server/src/LlmWiki.Api/Infrastructure/IngestWorker/IngestWorkerService.cs` — add static `InstanceId`, atomic claim via raw SQL, scoped startup recovery
- Modify: `llm-wiki-server/src/LlmWiki.Api/Infrastructure/IngestWorker/IngestPipelineService.cs` — remove claim guard (worker now claims before calling RunAsync)
- Create: `llm-wiki-server/tests/LlmWiki.Api.Tests/IngestWorkerStartupRecoveryTests.cs` — unit tests

### Gemini Provider (Task 4)
- Modify: `llm-wiki-server/src/LlmWiki.Api/Infrastructure/LlmClient/LlmHttpClient.cs` — add `StreamGeminiAsync`, `ParseGeminiLine`, `BuildGeminiUrl`
- Modify: `llm-wiki-server/tests/LlmWiki.Api.Tests/LlmHttpClientTests.cs` — Gemini parse + URL tests

### Embedding (Tasks 5–10)
- Create: `llm-wiki-server/src/LlmWiki.Api/Modules/Wiki/Entities/EmbeddingConfig.cs`
- Modify: `llm-wiki-server/src/LlmWiki.Api/Infrastructure/AppDbContext.cs` — add `DbSet<EmbeddingConfig>` + fluent config
- Run: `dotnet ef migrations add AddEmbeddingConfig`
- Create: `llm-wiki-server/src/LlmWiki.Api/Modules/Wiki/EmbeddingConfigController.cs` — CRUD API
- Create: `llm-wiki-server/src/LlmWiki.Api/Infrastructure/EmbeddingClient/IEmbeddingClient.cs`
- Create: `llm-wiki-server/src/LlmWiki.Api/Infrastructure/EmbeddingClient/EmbeddingHttpClient.cs` — OpenAI-compat + Google
- Create: `llm-wiki-server/src/LlmWiki.Api/Infrastructure/IngestWorker/TextChunker.cs`
- Modify: `llm-wiki-server/src/LlmWiki.Api/Infrastructure/IngestWorker/IngestPipelineService.cs` — add embedding step + new ctor params
- Modify: `llm-wiki-server/src/LlmWiki.Api/Program.cs` — register `IEmbeddingClient`
- Create: `llm-wiki-server/tests/LlmWiki.Api.Tests/EmbeddingHttpClientTests.cs`
- Create: `llm-wiki-server/tests/LlmWiki.Api.Tests/TextChunkerTests.cs`

---

## Task 1: Add LockedBy to IngestTask + Migration

**Files:**
- Modify: `llm-wiki-server/src/LlmWiki.Api/Modules/Wiki/Entities/IngestTask.cs`
- Generate: EF Core migration

- [ ] **Step 1: Add LockedBy property**

In `llm-wiki-server/src/LlmWiki.Api/Modules/Wiki/Entities/IngestTask.cs`, add after `ProgressDetail`:

```csharp
public string? LockedBy { get; set; }  // per-process instance ID during execution
```

- [ ] **Step 2: Generate migration**

From the `llm-wiki-server/src/LlmWiki.Api` directory:

```bash
dotnet ef migrations add AddLockedByToIngestTask
```

Open the generated migration and verify `Up()` contains:

```csharp
migrationBuilder.AddColumn<string>(
    name: "locked_by",
    table: "ingest_tasks",
    type: "text",
    nullable: true);
```

And `Down()` contains:

```csharp
migrationBuilder.DropColumn(name: "locked_by", table: "ingest_tasks");
```

- [ ] **Step 3: Commit**

```bash
git add llm-wiki-server/src/LlmWiki.Api/Modules/Wiki/Entities/IngestTask.cs
git add llm-wiki-server/src/LlmWiki.Api/Infrastructure/Migrations/
git commit -m "feat: add locked_by to ingest_tasks for multi-instance claim"
```

---

## Task 2: Atomic Claim in IngestWorkerService

**Files:**
- Modify: `llm-wiki-server/src/LlmWiki.Api/Infrastructure/IngestWorker/IngestWorkerService.cs`
- Create: `llm-wiki-server/tests/LlmWiki.Api.Tests/IngestWorkerStartupRecoveryTests.cs`

**Context:** Currently the worker does a plain SELECT, then `IngestPipelineService.RunAsync` does the UPDATE to 'running'. Under multiple instances, two workers can SELECT the same queued task simultaneously. Fix: generate a stable per-process `InstanceId`, use `UPDATE … FOR UPDATE SKIP LOCKED … RETURNING *` to atomically claim, and on startup reset only tasks locked by this instance.

- [ ] **Step 1: Add InMemory package to test project (needed for unit testing EF Core)**

```bash
cd llm-wiki-server/tests/LlmWiki.Api.Tests
dotnet add package Microsoft.EntityFrameworkCore.InMemory --version "8.0.*"
```

- [ ] **Step 2: Write the failing startup recovery test**

Create `llm-wiki-server/tests/LlmWiki.Api.Tests/IngestWorkerStartupRecoveryTests.cs`:

```csharp
using LlmWiki.Api.Infrastructure;
using LlmWiki.Api.Modules.Wiki.Entities;
using Microsoft.EntityFrameworkCore;

namespace LlmWiki.Api.Tests;

public class IngestWorkerStartupRecoveryTests
{
    private static AppDbContext CreateDb()
    {
        var opts = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new AppDbContext(opts);
    }

    [Fact]
    public async Task Startup_ResetsOwnRunningTasks_LeavesOtherInstanceTasks()
    {
        const string myId = "instance-A";
        const string otherId = "instance-B";

        await using var db = CreateDb();
        db.IngestTasks.AddRange(
            new IngestTask
            {
                Id = Guid.NewGuid(), DepartmentId = Guid.NewGuid(),
                Status = "running", LockedBy = myId,
                SourceFileName = "mine.md", SourceFilePath = "mine.md",
                QueuedAt = DateTime.UtcNow
            },
            new IngestTask
            {
                Id = Guid.NewGuid(), DepartmentId = Guid.NewGuid(),
                Status = "running", LockedBy = otherId,
                SourceFileName = "other.md", SourceFilePath = "other.md",
                QueuedAt = DateTime.UtcNow
            }
        );
        await db.SaveChangesAsync();

        // Simulate startup recovery — only reset own tasks
        await db.IngestTasks
            .Where(t => t.Status == "running" && t.LockedBy == myId)
            .ExecuteUpdateAsync(s => s
                .SetProperty(t => t.Status, "queued")
                .SetProperty(t => t.LockedBy, (string?)null));

        var tasks = await db.IngestTasks.ToListAsync();
        Assert.Equal("queued", tasks.Single(t => t.SourceFileName == "mine.md").Status);
        Assert.Null(tasks.Single(t => t.SourceFileName == "mine.md").LockedBy);
        Assert.Equal("running", tasks.Single(t => t.SourceFileName == "other.md").Status);
        Assert.Equal(otherId, tasks.Single(t => t.SourceFileName == "other.md").LockedBy);
    }

    [Fact]
    public async Task Startup_NoOwnTasks_DoesNothing()
    {
        await using var db = CreateDb();
        db.IngestTasks.Add(new IngestTask
        {
            Id = Guid.NewGuid(), DepartmentId = Guid.NewGuid(),
            Status = "running", LockedBy = "other-instance",
            SourceFileName = "f.md", SourceFilePath = "f.md",
            QueuedAt = DateTime.UtcNow
        });
        await db.SaveChangesAsync();

        var reset = await db.IngestTasks
            .Where(t => t.Status == "running" && t.LockedBy == "my-instance")
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.Status, "queued"));

        Assert.Equal(0, reset);
        Assert.Equal("running",
            (await db.IngestTasks.SingleAsync()).Status);
    }
}
```

- [ ] **Step 3: Run test — expect PASS (tests the recovery SQL logic directly)**

```bash
cd llm-wiki-server
dotnet test tests/LlmWiki.Api.Tests --filter "IngestWorkerStartupRecoveryTests"
```

Expected: PASS (the test exercises the SQL directly, not through the service)

- [ ] **Step 4: Rewrite IngestWorkerService**

Replace the full content of `llm-wiki-server/src/LlmWiki.Api/Infrastructure/IngestWorker/IngestWorkerService.cs`:

```csharp
using System.Threading.Channels;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace LlmWiki.Api.Infrastructure.IngestWorker;

public class IngestWorkerService(
    IServiceScopeFactory scopeFactory,
    ILogger<IngestWorkerService> logger)
    : BackgroundService, IIngestQueue
{
    // Stable per-process ID used to scope startup recovery and claim ownership.
    public static readonly string InstanceId = Guid.NewGuid().ToString("N");

    private readonly Channel<byte> _signal =
        Channel.CreateBounded<byte>(new BoundedChannelOptions(1)
        {
            FullMode = BoundedChannelFullMode.DropWrite,
            SingleReader = true,
        });

    public DateTime? LastCompletedAt { get; private set; }
    public Guid? CurrentTaskId { get; private set; }
    public bool IsAlive { get; private set; }

    public void Signal() => _signal.Writer.TryWrite(0);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        IsAlive = true;
        logger.LogInformation("[IngestWorker] Starting (instanceId={Id})", InstanceId);

        // On startup: only reset tasks WE locked (not tasks owned by sibling instances)
        await using (var scope = scopeFactory.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var reset = await db.IngestTasks
                .Where(t => t.Status == "running" && t.LockedBy == InstanceId)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(t => t.Status, "queued")
                    .SetProperty(t => t.LockedBy, (string?)null), stoppingToken);
            if (reset > 0)
                logger.LogWarning("[IngestWorker] Reset {Count} own interrupted tasks to queued", reset);
        }

        Signal();

        await foreach (var _ in _signal.Reader.ReadAllAsync(stoppingToken))
        {
            await ProcessAllQueuedAsync(stoppingToken);
        }

        IsAlive = false;
    }

    private async Task ProcessAllQueuedAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            LlmWiki.Api.Modules.Wiki.Entities.IngestTask? task;

            await using (var scope = scopeFactory.CreateAsyncScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                task = await TryClaimNextTaskAsync(db, ct);
            }

            if (task is null) break;

            CurrentTaskId = task.Id;
            logger.LogInformation("[IngestWorker] Claimed task {TaskId} ({File})",
                task.Id, task.SourceFileName);
            try
            {
                await using var scope = scopeFactory.CreateAsyncScope();
                var pipeline = scope.ServiceProvider
                    .GetRequiredService<IngestPipelineService>();
                await pipeline.RunAsync(task, ct);
                LastCompletedAt = DateTime.UtcNow;
                logger.LogInformation("[IngestWorker] Done: {TaskId}", task.Id);
            }
            catch (OperationCanceledException) { throw; }
            catch (Exception ex)
            {
                logger.LogError(ex, "[IngestWorker] Failed: {TaskId}", task.Id);
            }
            finally { CurrentTaskId = null; }
        }
    }

    // Atomically claim the next queued task using PostgreSQL FOR UPDATE SKIP LOCKED.
    // Returns the task already in status='running', or null if the queue is empty.
    // NOTE: requires a real PostgreSQL connection — cannot be tested with InMemory.
    private static async Task<LlmWiki.Api.Modules.Wiki.Entities.IngestTask?> TryClaimNextTaskAsync(
        AppDbContext db, CancellationToken ct)
    {
        var claimed = await db.IngestTasks
            .FromSqlInterpolated($"""
                UPDATE ingest_tasks
                SET status = 'running',
                    locked_by = {InstanceId},
                    started_at = NOW()
                WHERE id = (
                    SELECT id FROM ingest_tasks
                    WHERE status = 'queued'
                    ORDER BY queued_at
                    LIMIT 1
                    FOR UPDATE SKIP LOCKED
                )
                RETURNING *
                """)
            .AsNoTracking()
            .ToListAsync(ct);
        return claimed.FirstOrDefault();
    }
}
```

- [ ] **Step 5: Run all tests**

```bash
dotnet test tests/LlmWiki.Api.Tests
```

Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add llm-wiki-server/src/LlmWiki.Api/Infrastructure/IngestWorker/IngestWorkerService.cs
git add llm-wiki-server/tests/LlmWiki.Api.Tests/IngestWorkerStartupRecoveryTests.cs
git add llm-wiki-server/tests/LlmWiki.Api.Tests/LlmWiki.Api.Tests.csproj
git commit -m "feat: atomic task claim with FOR UPDATE SKIP LOCKED for multi-instance support"
```

---

## Task 3: Remove Claim Guard from IngestPipelineService

**Files:**
- Modify: `llm-wiki-server/src/LlmWiki.Api/Infrastructure/IngestWorker/IngestPipelineService.cs`

**Context:** `RunAsync` currently opens with `UPDATE … WHERE status='queued'` as an idempotency guard, returning early when `updated == 0`. After Task 2, the worker atomically sets status='running' before calling `RunAsync`, so the guard always sees `updated == 0` and returns immediately — breaking all ingestion. Remove it.

- [ ] **Step 1: Remove the claim guard**

In `llm-wiki-server/src/LlmWiki.Api/Infrastructure/IngestWorker/IngestPipelineService.cs`, find:

```csharp
    public async Task RunAsync(IngestTask task, CancellationToken ct)
    {
        // 原子标记为 running（幂等保护）
        var updated = await db.IngestTasks
            .Where(t => t.Id == task.Id && t.Status == "queued")
            .ExecuteUpdateAsync(s => s
                .SetProperty(t => t.Status, "running")
                .SetProperty(t => t.StartedAt, DateTime.UtcNow), ct);
        if (updated == 0) return; // 已被其他路径处理

        var deptId = task.DepartmentId;
```

Replace with:

```csharp
    public async Task RunAsync(IngestTask task, CancellationToken ct)
    {
        var deptId = task.DepartmentId;
```

- [ ] **Step 2: Run all tests**

```bash
cd llm-wiki-server
dotnet test tests/LlmWiki.Api.Tests
```

Expected: all tests pass

- [ ] **Step 3: Commit**

```bash
git add llm-wiki-server/src/LlmWiki.Api/Infrastructure/IngestWorker/IngestPipelineService.cs
git commit -m "fix: remove redundant claim guard from RunAsync (worker claims atomically)"
```

---

## Task 4: Gemini Provider in LlmHttpClient

**Files:**
- Modify: `llm-wiki-server/src/LlmWiki.Api/Infrastructure/LlmClient/LlmHttpClient.cs`
- Modify: `llm-wiki-server/tests/LlmWiki.Api.Tests/LlmHttpClientTests.cs`

**Context:** Gemini streaming endpoint: `POST {base}/v1beta/models/{model}:streamGenerateContent?key={key}&alt=sse`. System messages use `system_instruction`. Roles map `assistant` → `model`. SSE response: `data: {"candidates":[{"content":{"parts":[{"text":"…"}]}}]}`.

- [ ] **Step 1: Write failing Gemini tests**

In `llm-wiki-server/tests/LlmWiki.Api.Tests/LlmHttpClientTests.cs`, append:

```csharp
[Fact]
public void ParseGeminiLine_ContentDelta_ReturnsToken()
{
    var line = """data: {"candidates":[{"content":{"parts":[{"text":"hello"}],"role":"model"}}]}""";
    Assert.Equal("hello", LlmHttpClient.ParseGeminiLine(line));
}

[Theory]
[InlineData("", null)]
[InlineData("event: ping", null)]
[InlineData(": heartbeat", null)]
public void ParseGeminiLine_NonContent_ReturnsNull(string line, string? expected)
    => Assert.Equal(expected, LlmHttpClient.ParseGeminiLine(line));

[Fact]
public void ParseGeminiLine_NoTextField_ReturnsNull()
{
    // parts[0] has inlineData, not text
    var line = """data: {"candidates":[{"content":{"parts":[{"inlineData":{}}],"role":"model"}}]}""";
    Assert.Null(LlmHttpClient.ParseGeminiLine(line));
}

[Fact]
public void ParseGeminiLine_EmptyParts_ReturnsNull()
{
    // GetArrayLength() == 0 → guard before [0] access
    var line = """data: {"candidates":[{"content":{"parts":[],"role":"model"}}]}""";
    Assert.Null(LlmHttpClient.ParseGeminiLine(line));
}

[Theory]
[InlineData(
    "https://generativelanguage.googleapis.com",
    "gemini-2.0-flash", "key123",
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?key=key123&alt=sse")]
[InlineData(
    "https://generativelanguage.googleapis.com/v1beta",
    "gemini-2.0-flash", "key123",
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?key=key123&alt=sse")]
[InlineData(
    "https://generativelanguage.googleapis.com/v1beta/",
    "gemini-2.0-flash", "key123",
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?key=key123&alt=sse")]
public void BuildGeminiUrl_NormalizesEndpoint(string endpoint, string model, string key, string expected)
    => Assert.Equal(expected, LlmHttpClient.BuildGeminiUrl(endpoint, model, key));
```

- [ ] **Step 2: Run tests — expect compilation error**

```bash
cd llm-wiki-server
dotnet test tests/LlmWiki.Api.Tests --filter "ParseGeminiLine|BuildGeminiUrl"
```

Expected: build error (methods not defined yet)

- [ ] **Step 3a: Update StreamChatAsync to route 'google' provider**

In `llm-wiki-server/src/LlmWiki.Api/Infrastructure/LlmClient/LlmHttpClient.cs`, find:

```csharp
        if (config.Provider == "anthropic")
        {
            await foreach (var token in StreamAnthropicAsync(config, messages, options, ct))
                yield return token;
            yield break;
        }

        await foreach (var token in StreamOpenAiCompatAsync(config, messages, options, ct))
            yield return token;
```

Replace with:

```csharp
        if (config.Provider == "anthropic")
        {
            await foreach (var token in StreamAnthropicAsync(config, messages, options, ct))
                yield return token;
            yield break;
        }

        if (config.Provider == "google")
        {
            await foreach (var token in StreamGeminiAsync(config, messages, options, ct))
                yield return token;
            yield break;
        }

        await foreach (var token in StreamOpenAiCompatAsync(config, messages, options, ct))
            yield return token;
```

- [ ] **Step 3b: Add BuildGeminiUrl, ParseGeminiLine, StreamGeminiAsync to LlmHttpClient**

After the closing brace of `ParseAnthropicDeltaLine`, add:

```csharp
    internal static string BuildGeminiUrl(string endpoint, string model, string apiKey)
    {
        var base_ = endpoint.TrimEnd('/');
        if (base_.EndsWith("/v1beta", StringComparison.OrdinalIgnoreCase))
            base_ = base_[..^7];
        return $"{base_}/v1beta/models/{model}:streamGenerateContent?key={apiKey}&alt=sse";
    }

    private async IAsyncEnumerable<string> StreamGeminiAsync(
        LlmConfig config,
        IEnumerable<ChatMessage> messages,
        LlmOptions options,
        [EnumeratorCancellation] CancellationToken ct)
    {
        var url = BuildGeminiUrl(config.Endpoint, config.Model, config.EncryptedApiKey);
        var msgList = messages.ToList();
        var systemText = string.Join("\n", msgList
            .Where(m => m.Role == "system")
            .Select(m => m.Content));
        var contents = msgList
            .Where(m => m.Role != "system")
            .Select(m => new {
                role = m.Role == "assistant" ? "model" : m.Role,
                parts = new[] { new { text = m.Content } }
            })
            .ToList();

        var body = new Dictionary<string, object>
        {
            ["contents"] = contents,
            ["generationConfig"] = new {
                temperature = (double)options.Temperature,
                maxOutputTokens = options.MaxTokens,
            }
        };
        if (!string.IsNullOrEmpty(systemText))
            body["system_instruction"] = new { parts = new[] { new { text = systemText } } };

        using var request = new HttpRequestMessage(HttpMethod.Post, url);
        request.Content = new StringContent(
            JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");

        using var response = await http.SendAsync(
            request, HttpCompletionOption.ResponseHeadersRead, ct);
        if (!response.IsSuccessStatusCode)
        {
            var errorBody = await response.Content.ReadAsStringAsync(ct);
            throw new HttpRequestException(
                $"LLM API error {(int)response.StatusCode} from {url}: {errorBody}",
                null, response.StatusCode);
        }

        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        using var reader = new StreamReader(stream);

        while (!reader.EndOfStream && !ct.IsCancellationRequested)
        {
            var line = await reader.ReadLineAsync(ct);
            if (line is null) break;
            var token = ParseGeminiLine(line);
            if (token != null) yield return token;
        }
    }

    internal static string? ParseGeminiLine(string line)
    {
        if (!line.StartsWith("data: ")) return null;
        var data = line[6..].Trim();
        try
        {
            using var doc = JsonDocument.Parse(data);
            var parts = doc.RootElement
                .GetProperty("candidates")[0]
                .GetProperty("content")
                .GetProperty("parts");
            return parts.GetArrayLength() > 0 &&
                   parts[0].TryGetProperty("text", out var text)
                       ? text.GetString()
                       : null;
        }
        catch { return null; }
    }
```

- [ ] **Step 4: Run Gemini tests — expect PASS**

```bash
dotnet test tests/LlmWiki.Api.Tests --filter "ParseGeminiLine|BuildGeminiUrl"
```

Expected: PASS

- [ ] **Step 5: Run all tests**

```bash
dotnet test tests/LlmWiki.Api.Tests
```

Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add llm-wiki-server/src/LlmWiki.Api/Infrastructure/LlmClient/LlmHttpClient.cs
git add llm-wiki-server/tests/LlmWiki.Api.Tests/LlmHttpClientTests.cs
git commit -m "feat: add Google Gemini provider to LlmHttpClient"
```

---

## Task 5: EmbeddingConfig Entity + Migration

**Files:**
- Create: `llm-wiki-server/src/LlmWiki.Api/Modules/Wiki/Entities/EmbeddingConfig.cs`
- Modify: `llm-wiki-server/src/LlmWiki.Api/Infrastructure/AppDbContext.cs`
- Generate: EF Core migration

- [ ] **Step 1: Create EmbeddingConfig entity**

Create `llm-wiki-server/src/LlmWiki.Api/Modules/Wiki/Entities/EmbeddingConfig.cs`:

```csharp
namespace LlmWiki.Api.Modules.Wiki.Entities;

public class EmbeddingConfig
{
    public Guid Id { get; set; }
    public Guid? UserId { get; set; }           // non-null = user-level config
    public Guid? DepartmentId { get; set; }     // non-null = dept-level config (mutually exclusive)
    public string Provider { get; set; } = "";  // "openai" | "openai-compat" | "google"
    public string Endpoint { get; set; } = "";  // API base URL
    public string EncryptedApiKey { get; set; } = "";
    public string Model { get; set; } = "";     // e.g. "text-embedding-3-small"
    public int Dimensions { get; set; } = 1536; // vector size; must match Qdrant collection
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; }
}
```

- [ ] **Step 2: Add DbSet and fluent config to AppDbContext**

In `llm-wiki-server/src/LlmWiki.Api/Infrastructure/AppDbContext.cs`:

**2a.** Add after `DbSet<LlmConfig>`:

```csharp
    public DbSet<EmbeddingConfig> EmbeddingConfigs => Set<EmbeddingConfig>();
```

**2b.** In `OnModelCreating`, add after the `LlmConfig` entity block (after the closing `)`):

```csharp
        modelBuilder.Entity<EmbeddingConfig>(e =>
        {
            e.ToTable("embedding_configs", t => t.HasCheckConstraint(
                "chk_embedding_config_scope",
                "num_nonnulls(user_id, department_id) = 1"));
            e.HasKey(c => c.Id);
            e.Property(c => c.Id).HasDefaultValueSql("gen_random_uuid()");
            e.Property(c => c.IsActive).HasDefaultValue(true);
            e.Property(c => c.Dimensions).HasDefaultValue(1536);
            e.Property(c => c.CreatedAt).HasDefaultValueSql("now()");
            e.HasIndex(c => c.UserId)
             .HasFilter("user_id IS NOT NULL AND is_active = true")
             .IsUnique();
            e.HasIndex(c => c.DepartmentId)
             .HasFilter("department_id IS NOT NULL AND is_active = true")
             .IsUnique();
        });
```

- [ ] **Step 3: Generate migration**

```bash
cd llm-wiki-server/src/LlmWiki.Api
dotnet ef migrations add AddEmbeddingConfig
```

Verify the generated `Up()` creates the `embedding_configs` table with:
- `chk_embedding_config_scope` CHECK constraint
- Two partial unique indexes (one for `user_id`, one for `department_id`)

- [ ] **Step 4: Run all tests**

```bash
cd llm-wiki-server
dotnet test tests/LlmWiki.Api.Tests
```

Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add llm-wiki-server/src/LlmWiki.Api/Modules/Wiki/Entities/EmbeddingConfig.cs
git add llm-wiki-server/src/LlmWiki.Api/Infrastructure/AppDbContext.cs
git add llm-wiki-server/src/LlmWiki.Api/Infrastructure/Migrations/
git commit -m "feat: add EmbeddingConfig entity and migration"
```

---

## Task 6: EmbeddingConfig CRUD API

**Files:**
- Create: `llm-wiki-server/src/LlmWiki.Api/Modules/Wiki/EmbeddingConfigController.cs`

**Pattern:** Mirrors `LlmConfigController`. PUT deactivates the current active config for the scope before inserting a new one. Returns a DTO that never exposes the encrypted key — only `HasApiKey: bool`.

- [ ] **Step 1: Create EmbeddingConfigController**

Create `llm-wiki-server/src/LlmWiki.Api/Modules/Wiki/EmbeddingConfigController.cs`:

```csharp
using LlmWiki.Api.Infrastructure;
using LlmWiki.Api.Modules.Wiki.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace LlmWiki.Api.Modules.Wiki;

[ApiController]
[Authorize]
public class EmbeddingConfigController(
    AppDbContext db,
    LlmConfigService cryptoService,
    ICurrentUser currentUser) : ControllerBase
{
    // ── User-level ─────────────────────────────────────────────────────────

    [HttpGet("api/embedding-configs/me")]
    public async Task<IActionResult> GetMine(CancellationToken ct)
    {
        var cfg = await db.EmbeddingConfigs
            .Where(c => c.UserId == currentUser.Id && c.IsActive)
            .FirstOrDefaultAsync(ct);
        return cfg is null ? NoContent() : Ok(ToDto(cfg));
    }

    [HttpPut("api/embedding-configs/me")]
    public async Task<IActionResult> UpsertMine(
        [FromBody] EmbeddingConfigRequest req, CancellationToken ct)
    {
        await db.EmbeddingConfigs
            .Where(c => c.UserId == currentUser.Id && c.IsActive)
            .ExecuteUpdateAsync(s => s.SetProperty(c => c.IsActive, false), ct);

        var cfg = new EmbeddingConfig
        {
            Id = Guid.NewGuid(),
            UserId = currentUser.Id,
            Provider = req.Provider,
            Endpoint = req.Endpoint,
            EncryptedApiKey = cryptoService.EncryptIfNotEmpty(req.ApiKey ?? ""),
            Model = req.Model,
            Dimensions = req.Dimensions,
            IsActive = true,
            CreatedAt = DateTime.UtcNow,
        };
        db.EmbeddingConfigs.Add(cfg);
        await db.SaveChangesAsync(ct);
        return Ok(ToDto(cfg));
    }

    // ── Dept-level ─────────────────────────────────────────────────────────

    [HttpGet("api/departments/{deptId:guid}/embedding-config")]
    public async Task<IActionResult> GetDept(Guid deptId, CancellationToken ct)
    {
        var cfg = await db.EmbeddingConfigs
            .Where(c => c.DepartmentId == deptId && c.IsActive)
            .FirstOrDefaultAsync(ct);
        return cfg is null ? NoContent() : Ok(ToDto(cfg));
    }

    [HttpPut("api/departments/{deptId:guid}/embedding-config")]
    [RequireDeptRole("admin")]
    public async Task<IActionResult> UpsertDept(
        Guid deptId, [FromBody] EmbeddingConfigRequest req, CancellationToken ct)
    {
        await db.EmbeddingConfigs
            .Where(c => c.DepartmentId == deptId && c.IsActive)
            .ExecuteUpdateAsync(s => s.SetProperty(c => c.IsActive, false), ct);

        var cfg = new EmbeddingConfig
        {
            Id = Guid.NewGuid(),
            DepartmentId = deptId,
            Provider = req.Provider,
            Endpoint = req.Endpoint,
            EncryptedApiKey = cryptoService.EncryptIfNotEmpty(req.ApiKey ?? ""),
            Model = req.Model,
            Dimensions = req.Dimensions,
            IsActive = true,
            CreatedAt = DateTime.UtcNow,
        };
        db.EmbeddingConfigs.Add(cfg);
        await db.SaveChangesAsync(ct);
        return Ok(ToDto(cfg));
    }

    private static object ToDto(EmbeddingConfig cfg) => new
    {
        cfg.Id,
        cfg.Provider,
        cfg.Endpoint,
        cfg.Model,
        cfg.Dimensions,
        cfg.IsActive,
        cfg.CreatedAt,
        HasApiKey = !string.IsNullOrEmpty(cfg.EncryptedApiKey),
    };
}

public record EmbeddingConfigRequest(
    string Provider,
    string Endpoint,
    string? ApiKey,
    string Model,
    int Dimensions = 1536);
```

- [ ] **Step 2: Build**

```bash
cd llm-wiki-server
dotnet build src/LlmWiki.Api
```

Expected: no errors

- [ ] **Step 3: Run all tests**

```bash
dotnet test tests/LlmWiki.Api.Tests
```

Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add llm-wiki-server/src/LlmWiki.Api/Modules/Wiki/EmbeddingConfigController.cs
git commit -m "feat: add EmbeddingConfig CRUD API (user-level + dept-level)"
```

---

## Task 7: EmbeddingHttpClient

**Files:**
- Create: `llm-wiki-server/src/LlmWiki.Api/Infrastructure/EmbeddingClient/IEmbeddingClient.cs`
- Create: `llm-wiki-server/src/LlmWiki.Api/Infrastructure/EmbeddingClient/EmbeddingHttpClient.cs`
- Create: `llm-wiki-server/tests/LlmWiki.Api.Tests/EmbeddingHttpClientTests.cs`

**OpenAI-compat:** `POST {base}/v1/embeddings` `{"model":"…","input":["t1","t2"]}` → `{"data":[{"index":0,"embedding":[…]},…]}` (order by index).

**Google:** `POST {base}/v1beta/models/{model}:batchEmbedContents?key={key}` `{"requests":[{"model":"models/{model}","content":{"parts":[{"text":"…"}]}}]}` → `{"embeddings":[{"values":[…]},…]}` (same order as input).

- [ ] **Step 1: Write failing parse tests**

Create `llm-wiki-server/tests/LlmWiki.Api.Tests/EmbeddingHttpClientTests.cs`:

```csharp
using LlmWiki.Api.Infrastructure.EmbeddingClient;

namespace LlmWiki.Api.Tests;

public class EmbeddingHttpClientTests
{
    [Fact]
    public void ParseOpenAiResponse_ReturnsSortedEmbeddings()
    {
        // index 1 comes first in JSON, must be sorted to [0,1] order
        var json = """{"data":[{"index":1,"embedding":[0.2,0.3]},{"index":0,"embedding":[0.0,0.1]}]}""";
        var result = EmbeddingHttpClient.ParseOpenAiResponse(json);
        Assert.Equal(2, result.Length);
        Assert.Equal([0.0f, 0.1f], result[0]);
        Assert.Equal([0.2f, 0.3f], result[1]);
    }

    [Fact]
    public void ParseGoogleBatchResponse_ReturnsEmbeddingsInOrder()
    {
        var json = """{"embeddings":[{"values":[0.1,0.2]},{"values":[0.3,0.4]}]}""";
        var result = EmbeddingHttpClient.ParseGoogleBatchResponse(json);
        Assert.Equal(2, result.Length);
        Assert.Equal([0.1f, 0.2f], result[0]);
        Assert.Equal([0.3f, 0.4f], result[1]);
    }

    [Fact]
    public void NormalizeOpenAiBase_StripsTrailingV1()
    {
        Assert.Equal("https://api.openai.com",
            EmbeddingHttpClient.NormalizeOpenAiBase("https://api.openai.com/v1"));
        Assert.Equal("https://api.openai.com",
            EmbeddingHttpClient.NormalizeOpenAiBase("https://api.openai.com"));
        Assert.Equal("https://api.openai.com",
            EmbeddingHttpClient.NormalizeOpenAiBase("https://api.openai.com/v1/"));
    }

    [Theory]
    [InlineData(
        "https://generativelanguage.googleapis.com",
        "text-embedding-004", "mykey",
        "https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:batchEmbedContents?key=mykey")]
    [InlineData(
        "https://generativelanguage.googleapis.com/v1beta",
        "text-embedding-004", "mykey",
        "https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:batchEmbedContents?key=mykey")]
    public void BuildGoogleBatchUrl_NormalizesEndpoint(
        string endpoint, string model, string key, string expected)
        => Assert.Equal(expected, EmbeddingHttpClient.BuildGoogleBatchUrl(endpoint, model, key));
}
```

- [ ] **Step 2: Run tests — expect compilation error**

```bash
dotnet test tests/LlmWiki.Api.Tests --filter "EmbeddingHttpClientTests"
```

Expected: build error (types not defined)

- [ ] **Step 3: Create IEmbeddingClient**

Create `llm-wiki-server/src/LlmWiki.Api/Infrastructure/EmbeddingClient/IEmbeddingClient.cs`:

```csharp
using LlmWiki.Api.Modules.Wiki.Entities;

namespace LlmWiki.Api.Infrastructure.EmbeddingClient;

public interface IEmbeddingClient
{
    // Returns one float[] per input text, in the same order as texts.
    Task<float[][]> EmbedBatchAsync(
        EmbeddingConfig config,
        string[] texts,
        CancellationToken ct = default);
}
```

- [ ] **Step 4: Create EmbeddingHttpClient**

Create `llm-wiki-server/src/LlmWiki.Api/Infrastructure/EmbeddingClient/EmbeddingHttpClient.cs`:

```csharp
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using LlmWiki.Api.Modules.Wiki.Entities;

namespace LlmWiki.Api.Infrastructure.EmbeddingClient;

public class EmbeddingHttpClient(HttpClient http) : IEmbeddingClient
{
    public async Task<float[][]> EmbedBatchAsync(
        EmbeddingConfig config, string[] texts, CancellationToken ct = default)
    {
        if (config.Provider == "google")
            return await EmbedGoogleAsync(config, texts, ct);
        return await EmbedOpenAiCompatAsync(config, texts, ct);
    }

    private async Task<float[][]> EmbedOpenAiCompatAsync(
        EmbeddingConfig config, string[] texts, CancellationToken ct)
    {
        var url = NormalizeOpenAiBase(config.Endpoint) + "/v1/embeddings";
        var body = new { model = config.Model, input = texts };

        using var request = new HttpRequestMessage(HttpMethod.Post, url);
        request.Headers.Authorization =
            new AuthenticationHeaderValue("Bearer", config.EncryptedApiKey);
        request.Content = new StringContent(
            JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");

        using var response = await http.SendAsync(request, ct);
        if (!response.IsSuccessStatusCode)
        {
            var err = await response.Content.ReadAsStringAsync(ct);
            throw new HttpRequestException(
                $"Embedding API error {(int)response.StatusCode} from {url}: {err}",
                null, response.StatusCode);
        }

        return ParseOpenAiResponse(await response.Content.ReadAsStringAsync(ct));
    }

    private async Task<float[][]> EmbedGoogleAsync(
        EmbeddingConfig config, string[] texts, CancellationToken ct)
    {
        var url = BuildGoogleBatchUrl(config.Endpoint, config.Model, config.EncryptedApiKey);
        var requests = texts.Select(t => new {
            model = $"models/{config.Model}",
            content = new { parts = new[] { new { text = t } } }
        }).ToArray();

        using var request = new HttpRequestMessage(HttpMethod.Post, url);
        request.Content = new StringContent(
            JsonSerializer.Serialize(new { requests }), Encoding.UTF8, "application/json");

        using var response = await http.SendAsync(request, ct);
        if (!response.IsSuccessStatusCode)
        {
            var err = await response.Content.ReadAsStringAsync(ct);
            throw new HttpRequestException(
                $"Google Embedding API error {(int)response.StatusCode} from {url}: {err}",
                null, response.StatusCode);
        }

        return ParseGoogleBatchResponse(await response.Content.ReadAsStringAsync(ct));
    }

    internal static float[][] ParseOpenAiResponse(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.GetProperty("data")
            .EnumerateArray()
            .OrderBy(e => e.GetProperty("index").GetInt32())
            .Select(e => e.GetProperty("embedding")
                .EnumerateArray()
                .Select(v => v.GetSingle())
                .ToArray())
            .ToArray();
    }

    internal static float[][] ParseGoogleBatchResponse(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.GetProperty("embeddings")
            .EnumerateArray()
            .Select(e => e.GetProperty("values")
                .EnumerateArray()
                .Select(v => v.GetSingle())
                .ToArray())
            .ToArray();
    }

    internal static string NormalizeOpenAiBase(string endpoint)
    {
        var s = endpoint.TrimEnd('/');
        return Regex.IsMatch(s, @"/v\d+$") ? s[..s.LastIndexOf('/')] : s;
    }

    internal static string BuildGoogleBatchUrl(string endpoint, string model, string apiKey)
    {
        var base_ = endpoint.TrimEnd('/');
        if (base_.EndsWith("/v1beta", StringComparison.OrdinalIgnoreCase))
            base_ = base_[..^7];
        return $"{base_}/v1beta/models/{model}:batchEmbedContents?key={apiKey}";
    }
}
```

- [ ] **Step 5: Run embedding client tests — expect PASS**

```bash
dotnet test tests/LlmWiki.Api.Tests --filter "EmbeddingHttpClientTests"
```

Expected: PASS

- [ ] **Step 6: Run all tests**

```bash
dotnet test tests/LlmWiki.Api.Tests
```

Expected: all tests pass

- [ ] **Step 7: Commit**

```bash
git add llm-wiki-server/src/LlmWiki.Api/Infrastructure/EmbeddingClient/
git add llm-wiki-server/tests/LlmWiki.Api.Tests/EmbeddingHttpClientTests.cs
git commit -m "feat: add IEmbeddingClient with OpenAI-compat and Google Gemini embedding"
```

---

## Task 8: TextChunker

**Files:**
- Create: `llm-wiki-server/src/LlmWiki.Api/Infrastructure/IngestWorker/TextChunker.cs`
- Create: `llm-wiki-server/tests/LlmWiki.Api.Tests/TextChunkerTests.cs`

**Behavior:** Split markdown by `#`/`##`/`###` headings (heading text becomes `HeadingPath`). Within each section, accumulate paragraphs (`\n\n`-separated). Emit a chunk when the next paragraph would push it past 2000 characters. Chunks get sequential `Index` values across all sections.

- [ ] **Step 1: Write failing chunker tests**

Create `llm-wiki-server/tests/LlmWiki.Api.Tests/TextChunkerTests.cs`:

```csharp
using LlmWiki.Api.Infrastructure.IngestWorker;

namespace LlmWiki.Api.Tests;

public class TextChunkerTests
{
    [Fact]
    public void ChunkMarkdown_EmptyInput_ReturnsEmpty()
        => Assert.Empty(TextChunker.ChunkMarkdown(""));

    [Fact]
    public void ChunkMarkdown_WhitespaceOnly_ReturnsEmpty()
        => Assert.Empty(TextChunker.ChunkMarkdown("   \n\n  "));

    [Fact]
    public void ChunkMarkdown_NoHeadings_ReturnsSingleChunk()
    {
        var chunks = TextChunker.ChunkMarkdown("Some content.");
        Assert.Single(chunks);
        Assert.Equal("", chunks[0].HeadingPath);
        Assert.Equal("Some content.", chunks[0].Text);
        Assert.Equal(0, chunks[0].Index);
    }

    [Fact]
    public void ChunkMarkdown_WithHeadings_SplitsIntoSections()
    {
        var md = "## Introduction\n\nThis is intro.\n\n## Methods\n\nThis is methods.";
        var chunks = TextChunker.ChunkMarkdown(md);
        Assert.Equal(2, chunks.Count);
        Assert.Equal("Introduction", chunks[0].HeadingPath);
        Assert.Contains("intro", chunks[0].Text);
        Assert.Equal("Methods", chunks[1].HeadingPath);
        Assert.Contains("methods", chunks[1].Text);
        Assert.Equal(0, chunks[0].Index);
        Assert.Equal(1, chunks[1].Index);
    }

    [Fact]
    public void ChunkMarkdown_LongSection_SplitsByParagraph()
    {
        var para = new string('x', 800);
        // Three 800-char paragraphs in one section → must produce >1 chunk
        var md = $"## Big\n\n{para}\n\n{para}\n\n{para}";
        var chunks = TextChunker.ChunkMarkdown(md);
        Assert.True(chunks.Count > 1, $"Expected >1 chunk, got {chunks.Count}");
        Assert.All(chunks, c => Assert.Equal("Big", c.HeadingPath));
    }

    [Fact]
    public void ChunkMarkdown_AllChunksHaveSequentialIndexes()
    {
        var md = "## A\n\nContent A.\n\n## B\n\nContent B.\n\n## C\n\nContent C.";
        var chunks = TextChunker.ChunkMarkdown(md);
        for (int i = 0; i < chunks.Count; i++)
            Assert.Equal(i, chunks[i].Index);
    }

    [Fact]
    public void ChunkMarkdown_PreHeadingContent_UsesEmptyHeading()
    {
        var md = "Preamble text.\n\n## Section\n\nSection body.";
        var chunks = TextChunker.ChunkMarkdown(md);
        Assert.Equal(2, chunks.Count);
        Assert.Equal("", chunks[0].HeadingPath);
        Assert.Equal("Section", chunks[1].HeadingPath);
    }
}
```

- [ ] **Step 2: Run tests — expect compilation error**

```bash
dotnet test tests/LlmWiki.Api.Tests --filter "TextChunkerTests"
```

Expected: build error (type not defined)

- [ ] **Step 3: Create TextChunker**

Create `llm-wiki-server/src/LlmWiki.Api/Infrastructure/IngestWorker/TextChunker.cs`:

```csharp
using System.Text.RegularExpressions;

namespace LlmWiki.Api.Infrastructure.IngestWorker;

public record TextChunk(string HeadingPath, string Text, int Index);

public static class TextChunker
{
    private const int MaxChunkChars = 2000;
    private static readonly Regex HeadingRegex =
        new(@"^#{1,3}\s+(.+)$", RegexOptions.Multiline | RegexOptions.Compiled);

    public static IReadOnlyList<TextChunk> ChunkMarkdown(string markdown)
    {
        if (string.IsNullOrWhiteSpace(markdown)) return [];

        var chunks = new List<TextChunk>();
        int index = 0;

        foreach (var (heading, body) in SplitByHeadings(markdown))
        {
            if (string.IsNullOrWhiteSpace(body)) continue;

            var paragraphs = body.Split(
                ["\n\n", "\r\n\r\n"], StringSplitOptions.RemoveEmptyEntries);

            var current = "";
            foreach (var para in paragraphs)
            {
                var trimmed = para.Trim();
                if (trimmed.Length == 0) continue;

                if (current.Length > 0 && current.Length + trimmed.Length + 2 > MaxChunkChars)
                {
                    chunks.Add(new TextChunk(heading, current.Trim(), index++));
                    current = "";
                }
                current = current.Length > 0 ? current + "\n\n" + trimmed : trimmed;
            }
            if (current.Trim().Length > 0)
                chunks.Add(new TextChunk(heading, current.Trim(), index++));
        }

        return chunks;
    }

    private static IReadOnlyList<(string Heading, string Body)> SplitByHeadings(string text)
    {
        var result = new List<(string, string)>();
        var matches = HeadingRegex.Matches(text);

        if (matches.Count == 0)
        {
            result.Add(("", text));
            return result;
        }

        if (matches[0].Index > 0)
        {
            var pre = text[..matches[0].Index].Trim();
            if (pre.Length > 0) result.Add(("", pre));
        }

        for (int i = 0; i < matches.Count; i++)
        {
            var m = matches[i];
            var heading = m.Groups[1].Value.Trim();
            var start = m.Index + m.Length;
            var end = i + 1 < matches.Count ? matches[i + 1].Index : text.Length;
            var body = text[start..end].Trim();
            result.Add((heading, body));
        }

        return result;
    }
}
```

- [ ] **Step 4: Run chunker tests — expect PASS**

```bash
dotnet test tests/LlmWiki.Api.Tests --filter "TextChunkerTests"
```

Expected: PASS

- [ ] **Step 5: Run all tests**

```bash
dotnet test tests/LlmWiki.Api.Tests
```

Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add llm-wiki-server/src/LlmWiki.Api/Infrastructure/IngestWorker/TextChunker.cs
git add llm-wiki-server/tests/LlmWiki.Api.Tests/TextChunkerTests.cs
git commit -m "feat: add TextChunker for markdown-aware embedding chunking"
```

---

## Task 9: IngestPipeline Embedding Integration

**Files:**
- Modify: `llm-wiki-server/src/LlmWiki.Api/Infrastructure/IngestWorker/IngestPipelineService.cs`

**Context:** After writing wiki files and saving ingest cache, resolve EmbeddingConfig (user-level → dept-level), chunk each `wiki/` page, embed in batch, and upsert into Qdrant via the existing dept-scoped `VectorService.UpsertChunks(deptId, projectRoot, pageId, chunks)`. Failures log a warning and skip the page — they don't fail the whole task.

pageId format: normalize the file path to valid characters — `wiki/concepts/foo.md` → `wiki_concepts_foo.md` (replace `/` with `_`).

- [ ] **Step 1: Add new ctor parameters to IngestPipelineService**

In `llm-wiki-server/src/LlmWiki.Api/Infrastructure/IngestWorker/IngestPipelineService.cs`, change:

```csharp
public class IngestPipelineService(
    ILlmClient llmClient,
    FileService fileService,
    LlmConfigService llmConfigService,
    IngestEventBroadcaster broadcaster,
    AppDbContext db)
```

to:

```csharp
public class IngestPipelineService(
    ILlmClient llmClient,
    FileService fileService,
    LlmConfigService llmConfigService,
    IngestEventBroadcaster broadcaster,
    AppDbContext db,
    IEmbeddingClient embeddingClient,
    VectorService vectorService,
    ILogger<IngestPipelineService> logger)
```

Add the required usings at the top of the file (after existing usings):

```csharp
using LlmWiki.Api.Infrastructure.EmbeddingClient;
using LlmWiki.Api.Models;
using LlmWiki.Api.Services;
```

- [ ] **Step 2: Add EmbedWikiPagesAsync method**

After the `MarkDone` method, add:

```csharp
    private async Task EmbedWikiPagesAsync(
        IngestTask task,
        IReadOnlyList<ParsedFileBlock> blocks,
        string projectRoot,
        CancellationToken ct)
    {
        // Resolve: user-level config → dept-level fallback → skip if neither
        EmbeddingConfig? embConfig = null;
        if (task.TriggeredBy.HasValue)
            embConfig = await db.EmbeddingConfigs
                .Where(c => c.UserId == task.TriggeredBy && c.IsActive)
                .FirstOrDefaultAsync(ct);
        embConfig ??= await db.EmbeddingConfigs
            .Where(c => c.DepartmentId == task.DepartmentId && c.IsActive)
            .FirstOrDefaultAsync(ct);

        if (embConfig is null) return;

        var runtimeEmb = new EmbeddingConfig
        {
            Id = embConfig.Id,
            UserId = embConfig.UserId,
            DepartmentId = embConfig.DepartmentId,
            Provider = embConfig.Provider,
            Endpoint = embConfig.Endpoint,
            EncryptedApiKey = llmConfigService.DecryptIfNotEmpty(embConfig.EncryptedApiKey),
            Model = embConfig.Model,
            Dimensions = embConfig.Dimensions,
            IsActive = embConfig.IsActive,
            CreatedAt = embConfig.CreatedAt,
        };

        foreach (var block in blocks.Where(b => b.Path.StartsWith("wiki/")))
        {
            var chunks = TextChunker.ChunkMarkdown(block.Content);
            if (chunks.Count == 0) continue;

            float[][] embeddings;
            try
            {
                embeddings = await embeddingClient.EmbedBatchAsync(
                    runtimeEmb, chunks.Select(c => c.Text).ToArray(), ct);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "[Ingest] Embedding failed for {Path}, skipping", block.Path);
                continue;
            }

            if (embeddings.Length != chunks.Count)
            {
                logger.LogWarning(
                    "[Ingest] Embedding count mismatch for {Path}: expected {E}, got {G}",
                    block.Path, chunks.Count, embeddings.Length);
                continue;
            }

            // pageId: replace / with _ to satisfy VectorService validation ([a-zA-Z0-9\-_.])
            var pageId = block.Path.Replace('/', '_');
            var chunkInputs = chunks.Select((c, i) => new ChunkUpsertInput(
                (uint)c.Index, c.Text, c.HeadingPath, embeddings[i]
            )).ToArray();

            await vectorService.UpsertChunks(task.DepartmentId, projectRoot, pageId, chunkInputs);
        }
    }
```

- [ ] **Step 3: Call EmbedWikiPagesAsync in RunAsync**

In `RunAsync`, find:

```csharp
            // 写 ingest cache（仅在有文件写出后）
            if (writtenPaths.Count > 0)
                await SaveIngestCacheAsync(projectRoot, task.SourceFileName, sourceContent, writtenPaths);

            await MarkDone(task.Id, writtenPaths.Count,
```

Replace with:

```csharp
            // 写 ingest cache（仅在有文件写出后）
            if (writtenPaths.Count > 0)
                await SaveIngestCacheAsync(projectRoot, task.SourceFileName, sourceContent, writtenPaths);

            // Embed generated wiki pages (skips gracefully when EmbeddingConfig is absent)
            await EmbedWikiPagesAsync(task, parseResult.Blocks, projectRoot, ct);

            await MarkDone(task.Id, writtenPaths.Count,
```

- [ ] **Step 4: Run all tests**

```bash
cd llm-wiki-server
dotnet test tests/LlmWiki.Api.Tests
```

Expected: all tests pass. The existing `ParseFileBlocksTests` only call the static `ParseFileBlocks` method and don't instantiate `IngestPipelineService`, so the constructor change doesn't break them.

- [ ] **Step 5: Commit**

```bash
git add llm-wiki-server/src/LlmWiki.Api/Infrastructure/IngestWorker/IngestPipelineService.cs
git commit -m "feat: embed wiki pages after ingest using EmbeddingConfig and VectorService"
```

---

## Task 10: Register IEmbeddingClient in Program.cs

**Files:**
- Modify: `llm-wiki-server/src/LlmWiki.Api/Program.cs`

- [ ] **Step 1: Add using and register service**

In `llm-wiki-server/src/LlmWiki.Api/Program.cs`:

**1a.** Add using after the existing LlmClient using:

```csharp
using LlmWiki.Api.Infrastructure.EmbeddingClient;
```

**1b.** After the existing `AddHttpClient<ILlmClient, LlmHttpClient>` line, add:

```csharp
builder.Services.AddHttpClient<IEmbeddingClient, EmbeddingHttpClient>(c =>
    c.Timeout = TimeSpan.FromSeconds(60));
```

- [ ] **Step 2: Build**

```bash
cd llm-wiki-server
dotnet build src/LlmWiki.Api
```

Expected: no errors

- [ ] **Step 3: Run all tests**

```bash
dotnet test tests/LlmWiki.Api.Tests
```

Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add llm-wiki-server/src/LlmWiki.Api/Program.cs
git commit -m "feat: register IEmbeddingClient in DI container"
```

---

## Self-Review Checklist

**Spec coverage:**

| Phase 2 Item | Covered by |
|---|---|
| 多实例支持（DB 级原子 claim/lease） | Tasks 1–3 |
| Gemini provider 支持 | Task 4 |
| 向量 embedding（基于已有 VectorController） | Tasks 5–10 |

**Gaps / known limitations:**
- Embedding is triggered per-ingest. There is no backfill mechanism for pages ingested before Phase 2 is deployed. A backfill can be added as a separate maintenance task.
- `TryClaimNextTaskAsync` uses raw SQL and cannot be tested with InMemory provider; requires integration test against a real PostgreSQL instance.
- EmbeddingConfig API does not have frontend UI yet — only the REST endpoints are added.

**Placeholder scan:** No TBD/TODO in plan.

**Type consistency:**
- `ChunkUpsertInput` constructor: `(uint ChunkIndex, string ChunkText, string HeadingPath, float[] Embedding)` — verified against `VectorModels.cs`.
- `EmbeddingConfig` properties match between entity, controller DTO, and pipeline usage.
- `TextChunk` record: `(string HeadingPath, string Text, int Index)` — consistent across TextChunker and IngestPipelineService usage.
