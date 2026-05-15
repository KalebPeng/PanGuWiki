# Ingest Backend Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 ingest 执行权从浏览器迁移到 .NET 后端，通过 `IngestWorkerService` + SSE 推送实现服务端执行和实时进度。

**Architecture:** `IngestWorkerService`（IHostedService）监听一个容量为 1 的信号 Channel，收到信号后从 DB 查取 queued 任务并串行执行 `IngestPipelineService`；`IngestEventBroadcaster` 为每条 SSE 连接维护独立 Channel 并广播进度；前端通过短效 SSE token 订阅部门级进度流。

**Tech Stack:** .NET 8 ASP.NET Core, EF Core + PostgreSQL, xUnit (已有测试项目), React + Vitest

---

## File Map

### 新建后端文件
| 路径 | 职责 |
|------|------|
| `llm-wiki-server/src/LlmWiki.Api/Modules/Wiki/Entities/LlmConfig.cs` | LlmConfig 实体 |
| `llm-wiki-server/src/LlmWiki.Api/Modules/Wiki/LlmConfigController.cs` | LlmConfig CRUD API |
| `llm-wiki-server/src/LlmWiki.Api/Infrastructure/LlmConfigService.cs` | IDataProtector 加密封装 |
| `llm-wiki-server/src/LlmWiki.Api/Infrastructure/LlmClient/ILlmClient.cs` | streaming LLM 接口 |
| `llm-wiki-server/src/LlmWiki.Api/Infrastructure/LlmClient/LlmHttpClient.cs` | OpenAI-compat + Anthropic 实现 |
| `llm-wiki-server/src/LlmWiki.Api/Infrastructure/LlmClient/AnthropicUrlBuilder.cs` | Anthropic URL 规范化 |
| `llm-wiki-server/src/LlmWiki.Api/Infrastructure/IngestWorker/IIngestQueue.cs` | 入队接口 |
| `llm-wiki-server/src/LlmWiki.Api/Infrastructure/IngestWorker/IngestEventBroadcaster.cs` | SSE 广播器 |
| `llm-wiki-server/src/LlmWiki.Api/Infrastructure/IngestWorker/SseTokenService.cs` | SSE token 管理 |
| `llm-wiki-server/src/LlmWiki.Api/Infrastructure/IngestWorker/IngestPipelineService.cs` | 两步 LLM 管道 |
| `llm-wiki-server/src/LlmWiki.Api/Infrastructure/IngestWorker/IngestWorkerService.cs` | IHostedService + Channel |
| `llm-wiki-server/src/LlmWiki.Api/Modules/Wiki/SseController.cs` | SSE token + events 端点 |

### 修改后端文件
| 路径 | 改动 |
|------|------|
| `Infrastructure/AppDbContext.cs` | 添加 `DbSet<LlmConfig>` + LlmConfig ModelBuilder |
| `Modules/Wiki/Entities/IngestTask.cs` | 添加 `ProgressDetail` 字段 |
| `Modules/Wiki/IngestTaskController.cs` | 注入 `IIngestQueue`，Create 后调用 `Enqueue` |
| `Program.cs` | 注册新服务，配置 DataProtection key ring |
| `Infrastructure/Migrations/` | 新增迁移 |

### 新建/修改前端文件
| 路径 | 改动 |
|------|------|
| `src/api/sse-client.ts` | 新建：SSE token 获取 + EventSource 封装 |
| `src/lib/ingest-queue.ts` | 移除 `processNext` / `autoIngest` 调用路径 |
| `src/stores/tasks-store.ts` | 连接 SSE 事件更新任务状态 |
| `src/components/settings/UserLlmConfigSettings.tsx` | 新建：用户级 LLM 配置页 |

---

## Task 1: LlmConfig 实体 + IngestTask 扩展 + DB 迁移

**Files:**
- Create: `llm-wiki-server/src/LlmWiki.Api/Modules/Wiki/Entities/LlmConfig.cs`
- Modify: `llm-wiki-server/src/LlmWiki.Api/Modules/Wiki/Entities/IngestTask.cs`
- Modify: `llm-wiki-server/src/LlmWiki.Api/Infrastructure/AppDbContext.cs`

- [ ] **Step 1: 创建 LlmConfig 实体**

```csharp
// llm-wiki-server/src/LlmWiki.Api/Modules/Wiki/Entities/LlmConfig.cs
namespace LlmWiki.Api.Modules.Wiki.Entities;

public class LlmConfig
{
    public Guid Id { get; set; }
    public Guid? UserId { get; set; }           // 非空 = 用户级
    public Guid? DepartmentId { get; set; }     // 非空 = 部门级
    public string Provider { get; set; } = "";  // "openai" | "anthropic" | "ollama" | ...
    public string Endpoint { get; set; } = "";  // base URL
    public string EncryptedApiKey { get; set; } = "";
    public string Model { get; set; } = "";
    public string? ApiMode { get; set; }        // "openai-compat" | "anthropic-native"
    public int MaxContextSize { get; set; } = 32000;
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; }
}
```

- [ ] **Step 2: 给 IngestTask 添加 ProgressDetail**

在 `llm-wiki-server/src/LlmWiki.Api/Modules/Wiki/Entities/IngestTask.cs` 末尾添加：

```csharp
    public string? ProgressDetail { get; set; }
```

- [ ] **Step 3: 更新 AppDbContext**

在 `llm-wiki-server/src/LlmWiki.Api/Infrastructure/AppDbContext.cs` 的 `DbSet` 区域添加：

```csharp
    public DbSet<LlmConfig> LlmConfigs => Set<LlmConfig>();
```

在 `OnModelCreating` 末尾添加：

```csharp
        modelBuilder.Entity<LlmConfig>(e =>
        {
            e.ToTable("llm_configs");
            e.HasKey(c => c.Id);
            e.Property(c => c.Id).HasDefaultValueSql("gen_random_uuid()");
            e.Property(c => c.IsActive).HasDefaultValue(true);
            e.Property(c => c.MaxContextSize).HasDefaultValue(32000);
            e.Property(c => c.CreatedAt).HasDefaultValueSql("now()");
            // 恰好一个 scope 非空（DB 约束）
            e.ToTable(t => t.HasCheckConstraint(
                "chk_llm_config_scope",
                "num_nonnulls(user_id, department_id) = 1"));
            // 每个用户最多一个 active 配置
            e.HasIndex(c => c.UserId)
             .HasFilter("user_id IS NOT NULL AND is_active = true")
             .IsUnique();
            // 每个部门最多一个 active 配置
            e.HasIndex(c => c.DepartmentId)
             .HasFilter("department_id IS NOT NULL AND is_active = true")
             .IsUnique();
        });
```

- [ ] **Step 4: 生成并运行迁移**

```bash
cd llm-wiki-server
dotnet ef migrations add AddLlmConfigAndIngestProgress \
  --project src/LlmWiki.Api \
  --output-dir Infrastructure/Migrations
dotnet ef database update --project src/LlmWiki.Api
```

预期输出：`Done.`

- [ ] **Step 5: 验证**

```bash
dotnet build llm-wiki-server/src/LlmWiki.Api/LlmWiki.Api.csproj
```

预期：`Build succeeded.`

- [ ] **Step 6: Commit**

```bash
git add llm-wiki-server/src/LlmWiki.Api/Modules/Wiki/Entities/LlmConfig.cs \
        llm-wiki-server/src/LlmWiki.Api/Modules/Wiki/Entities/IngestTask.cs \
        llm-wiki-server/src/LlmWiki.Api/Infrastructure/AppDbContext.cs \
        llm-wiki-server/src/LlmWiki.Api/Infrastructure/Migrations/
git commit -m "feat: add LlmConfig entity and IngestTask.ProgressDetail"
```

---

## Task 2: DataProtection 配置 + LlmConfigService

**Files:**
- Create: `llm-wiki-server/src/LlmWiki.Api/Infrastructure/LlmConfigService.cs`
- Modify: `llm-wiki-server/src/LlmWiki.Api/Program.cs`
- Create: `llm-wiki-server/tests/LlmWiki.Api.Tests/LlmConfigServiceTests.cs`

- [ ] **Step 1: 创建 LlmConfigService**

```csharp
// llm-wiki-server/src/LlmWiki.Api/Infrastructure/LlmConfigService.cs
using Microsoft.AspNetCore.DataProtection;

namespace LlmWiki.Api.Infrastructure;

public class LlmConfigService(IDataProtectionProvider provider)
{
    private readonly IDataProtector _protector =
        provider.CreateProtector("LlmWiki.ApiKeys");

    public string Encrypt(string plainKey) => _protector.Protect(plainKey);
    public string Decrypt(string encryptedKey) => _protector.Unprotect(encryptedKey);

    // 空 key 不加密（用户可能配置了不需要 key 的本地 Ollama）
    public string EncryptIfNotEmpty(string plainKey) =>
        string.IsNullOrEmpty(plainKey) ? plainKey : Encrypt(plainKey);

    public string DecryptIfNotEmpty(string encryptedKey) =>
        string.IsNullOrEmpty(encryptedKey) ? encryptedKey : Decrypt(encryptedKey);
}
```

- [ ] **Step 2: 在 Program.cs 注册 DataProtection（在 `var app = builder.Build()` 之前）**

```csharp
// DataProtection — key ring 必须持久化，否则容器重建后无法解密
var keysPath = builder.Configuration["DataProtection:KeysPath"] ?? "/data/keys";
builder.Services.AddDataProtection()
    .PersistKeysToFileSystem(new System.IO.DirectoryInfo(keysPath));

builder.Services.AddSingleton<LlmConfigService>();
```

- [ ] **Step 3: 编写测试**

```csharp
// llm-wiki-server/tests/LlmWiki.Api.Tests/LlmConfigServiceTests.cs
using LlmWiki.Api.Infrastructure;
using Microsoft.AspNetCore.DataProtection;

namespace LlmWiki.Api.Tests;

public class LlmConfigServiceTests
{
    private static LlmConfigService CreateService()
    {
        var provider = new EphemeralDataProtectionProvider();
        return new LlmConfigService(provider);
    }

    [Fact]
    public void Encrypt_ThenDecrypt_ReturnsOriginal()
    {
        var svc = CreateService();
        var plain = "sk-test-12345";
        var encrypted = svc.Encrypt(plain);
        Assert.NotEqual(plain, encrypted);
        Assert.Equal(plain, svc.Decrypt(encrypted));
    }

    [Fact]
    public void EncryptIfNotEmpty_EmptyKey_ReturnsEmpty()
    {
        var svc = CreateService();
        Assert.Equal("", svc.EncryptIfNotEmpty(""));
    }

    [Fact]
    public void DecryptIfNotEmpty_EmptyKey_ReturnsEmpty()
    {
        var svc = CreateService();
        Assert.Equal("", svc.DecryptIfNotEmpty(""));
    }
}
```

- [ ] **Step 4: 运行测试**

```bash
cd llm-wiki-server
dotnet test tests/LlmWiki.Api.Tests --filter "LlmConfigServiceTests"
```

预期：`3 passed`

- [ ] **Step 5: Commit**

```bash
git add llm-wiki-server/src/LlmWiki.Api/Infrastructure/LlmConfigService.cs \
        llm-wiki-server/src/LlmWiki.Api/Program.cs \
        llm-wiki-server/tests/LlmWiki.Api.Tests/LlmConfigServiceTests.cs
git commit -m "feat: add LlmConfigService with DataProtection encryption"
```

---

## Task 3: LlmConfig CRUD API

**Files:**
- Create: `llm-wiki-server/src/LlmWiki.Api/Modules/Wiki/LlmConfigController.cs`

- [ ] **Step 1: 创建 LlmConfigController**

```csharp
// llm-wiki-server/src/LlmWiki.Api/Modules/Wiki/LlmConfigController.cs
using LlmWiki.Api.Infrastructure;
using LlmWiki.Api.Modules.Wiki.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace LlmWiki.Api.Modules.Wiki;

public record UpsertLlmConfigRequest(
    string Provider,
    string Endpoint,
    string ApiKey,
    string Model,
    string? ApiMode,
    int MaxContextSize = 32000);

public record LlmConfigResponse(
    Guid Id,
    string Provider,
    string Endpoint,
    bool HasApiKey,
    string Model,
    string? ApiMode,
    int MaxContextSize,
    bool IsActive);

[ApiController]
[Authorize]
public class LlmConfigController(
    AppDbContext db,
    LlmConfigService configService,
    ICurrentUser currentUser) : ControllerBase
{
    private static LlmConfigResponse ToResponse(LlmConfig c) => new(
        c.Id, c.Provider, c.Endpoint,
        !string.IsNullOrEmpty(c.EncryptedApiKey),
        c.Model, c.ApiMode, c.MaxContextSize, c.IsActive);

    /// <summary>GET /api/llm-configs/me — 当前用户的配置</summary>
    [HttpGet("api/llm-configs/me")]
    public async Task<IActionResult> GetMine()
    {
        if (!currentUser.IsAuthenticated) return Unauthorized();
        var config = await db.LlmConfigs
            .Where(c => c.UserId == currentUser.UserId && c.IsActive)
            .FirstOrDefaultAsync();
        return config is null ? NotFound() : Ok(ToResponse(config));
    }

    /// <summary>PUT /api/llm-configs/me — 创建或更新当前用户配置</summary>
    [HttpPut("api/llm-configs/me")]
    public async Task<IActionResult> UpsertMine([FromBody] UpsertLlmConfigRequest req)
    {
        if (!currentUser.IsAuthenticated) return Unauthorized();
        // 旧配置置为 inactive
        await db.LlmConfigs
            .Where(c => c.UserId == currentUser.UserId && c.IsActive)
            .ExecuteUpdateAsync(s => s.SetProperty(c => c.IsActive, false));

        var config = new LlmConfig
        {
            UserId = currentUser.UserId,
            Provider = req.Provider,
            Endpoint = req.Endpoint,
            EncryptedApiKey = configService.EncryptIfNotEmpty(req.ApiKey),
            Model = req.Model,
            ApiMode = req.ApiMode,
            MaxContextSize = req.MaxContextSize,
            IsActive = true,
        };
        db.LlmConfigs.Add(config);
        await db.SaveChangesAsync();
        return Ok(ToResponse(config));
    }

    /// <summary>GET /api/departments/{deptId}/llm-config — 部门配置</summary>
    [HttpGet("api/departments/{deptId:guid}/llm-config")]
    [RequireDeptRole]
    public async Task<IActionResult> GetDept(Guid deptId)
    {
        var config = await db.LlmConfigs
            .Where(c => c.DepartmentId == deptId && c.IsActive)
            .FirstOrDefaultAsync();
        return config is null ? NotFound() : Ok(ToResponse(config));
    }

    /// <summary>PUT /api/departments/{deptId}/llm-config — 创建或更新部门配置（管理员）</summary>
    [HttpPut("api/departments/{deptId:guid}/llm-config")]
    [RequireDeptRole]
    public async Task<IActionResult> UpsertDept(Guid deptId, [FromBody] UpsertLlmConfigRequest req)
    {
        await db.LlmConfigs
            .Where(c => c.DepartmentId == deptId && c.IsActive)
            .ExecuteUpdateAsync(s => s.SetProperty(c => c.IsActive, false));

        var config = new LlmConfig
        {
            DepartmentId = deptId,
            Provider = req.Provider,
            Endpoint = req.Endpoint,
            EncryptedApiKey = configService.EncryptIfNotEmpty(req.ApiKey),
            Model = req.Model,
            ApiMode = req.ApiMode,
            MaxContextSize = req.MaxContextSize,
            IsActive = true,
        };
        db.LlmConfigs.Add(config);
        await db.SaveChangesAsync();
        return Ok(ToResponse(config));
    }
}
```

- [ ] **Step 2: 验证编译**

```bash
cd llm-wiki-server
dotnet build src/LlmWiki.Api/LlmWiki.Api.csproj
```

预期：`Build succeeded.`

- [ ] **Step 3: Commit**

```bash
git add llm-wiki-server/src/LlmWiki.Api/Modules/Wiki/LlmConfigController.cs
git commit -m "feat: LlmConfig CRUD API (user + dept scope)"
```

---

## Task 4: ILlmClient + OpenAI-compat 流式实现

**Files:**
- Create: `llm-wiki-server/src/LlmWiki.Api/Infrastructure/LlmClient/ILlmClient.cs`
- Create: `llm-wiki-server/src/LlmWiki.Api/Infrastructure/LlmClient/LlmHttpClient.cs`
- Create: `llm-wiki-server/tests/LlmWiki.Api.Tests/LlmHttpClientTests.cs`

- [ ] **Step 1: 创建接口和数据类型**

```csharp
// llm-wiki-server/src/LlmWiki.Api/Infrastructure/LlmClient/ILlmClient.cs
using LlmWiki.Api.Modules.Wiki.Entities;

namespace LlmWiki.Api.Infrastructure.LlmClient;

public record ChatMessage(string Role, string Content);

public record LlmOptions(
    float Temperature = 0.1f,
    int MaxTokens = 8192);

public interface ILlmClient
{
    IAsyncEnumerable<string> StreamChatAsync(
        LlmConfig config,
        IEnumerable<ChatMessage> messages,
        LlmOptions options,
        CancellationToken ct = default);
}
```

- [ ] **Step 2: 创建 LlmHttpClient（OpenAI 分支）**

```csharp
// llm-wiki-server/src/LlmWiki.Api/Infrastructure/LlmClient/LlmHttpClient.cs
using System.Net.Http.Headers;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using LlmWiki.Api.Modules.Wiki.Entities;

namespace LlmWiki.Api.Infrastructure.LlmClient;

public class LlmHttpClient(HttpClient http) : ILlmClient
{
    public async IAsyncEnumerable<string> StreamChatAsync(
        LlmConfig config,
        IEnumerable<ChatMessage> messages,
        LlmOptions options,
        [EnumeratorCancellation] CancellationToken ct = default)
    {
        if (config.Provider == "anthropic")
        {
            await foreach (var token in StreamAnthropicAsync(config, messages, options, ct))
                yield return token;
        }
        else
        {
            await foreach (var token in StreamOpenAiCompatAsync(config, messages, options, ct))
                yield return token;
        }
    }

    private async IAsyncEnumerable<string> StreamOpenAiCompatAsync(
        LlmConfig config,
        IEnumerable<ChatMessage> messages,
        LlmOptions options,
        [EnumeratorCancellation] CancellationToken ct)
    {
        var url = config.Endpoint.TrimEnd('/') + "/v1/chat/completions";
        var body = new
        {
            model = config.Model,
            messages = messages.Select(m => new { role = m.Role, content = m.Content }),
            stream = true,
            temperature = options.Temperature,
            max_tokens = options.MaxTokens,
        };

        using var request = new HttpRequestMessage(HttpMethod.Post, url);
        request.Headers.Authorization =
            new AuthenticationHeaderValue("Bearer", config.EncryptedApiKey); // caller decrypts before passing
        request.Content = new StringContent(
            JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");

        using var response = await http.SendAsync(
            request, HttpCompletionOption.ResponseHeadersRead, ct);
        response.EnsureSuccessStatusCode();

        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        using var reader = new StreamReader(stream);

        while (!reader.EndOfStream && !ct.IsCancellationRequested)
        {
            var line = await reader.ReadLineAsync(ct);
            if (line is null) break;
            var token = ParseOpenAiLine(line);
            if (token == null) continue;
            if (token == "[DONE]") yield break;
            yield return token;
        }
    }

    // OpenAI SSE: "data: {json}" or "data: [DONE]"
    // Returns null for non-data lines, "[DONE]" for terminator, token text otherwise
    internal static string? ParseOpenAiLine(string line)
    {
        if (!line.StartsWith("data: ")) return null;
        var data = line[6..].Trim();
        if (data == "[DONE]") return "[DONE]";
        try
        {
            using var doc = JsonDocument.Parse(data);
            return doc.RootElement
                .GetProperty("choices")[0]
                .GetProperty("delta")
                .TryGetProperty("content", out var content)
                    ? content.GetString()
                    : null;
        }
        catch { return null; }
    }
}
```

- [ ] **Step 3: 编写 OpenAI 解析单元测试**

```csharp
// llm-wiki-server/tests/LlmWiki.Api.Tests/LlmHttpClientTests.cs
using LlmWiki.Api.Infrastructure.LlmClient;

namespace LlmWiki.Api.Tests;

public class LlmHttpClientTests
{
    [Theory]
    [InlineData("data: [DONE]", "[DONE]")]
    [InlineData("", null)]
    [InlineData("event: ping", null)]
    [InlineData(": heartbeat", null)]
    public void ParseOpenAiLine_NonContent_ReturnsExpected(string line, string? expected)
        => Assert.Equal(expected, LlmHttpClient.ParseOpenAiLine(line));

    [Fact]
    public void ParseOpenAiLine_ContentDelta_ReturnsToken()
    {
        var line = """data: {"choices":[{"delta":{"content":"hello"}}]}""";
        Assert.Equal("hello", LlmHttpClient.ParseOpenAiLine(line));
    }

    [Fact]
    public void ParseOpenAiLine_EmptyDelta_ReturnsNull()
    {
        var line = """data: {"choices":[{"delta":{}}]}""";
        Assert.Null(LlmHttpClient.ParseOpenAiLine(line));
    }
}
```

- [ ] **Step 4: 运行测试**

```bash
cd llm-wiki-server
dotnet test tests/LlmWiki.Api.Tests --filter "LlmHttpClientTests"
```

预期：`4 passed`

- [ ] **Step 5: Commit**

```bash
git add llm-wiki-server/src/LlmWiki.Api/Infrastructure/LlmClient/ \
        llm-wiki-server/tests/LlmWiki.Api.Tests/LlmHttpClientTests.cs
git commit -m "feat: ILlmClient + OpenAI-compat streaming"
```

---

## Task 5: Anthropic 流式分支 + URL Builder

**Files:**
- Create: `llm-wiki-server/src/LlmWiki.Api/Infrastructure/LlmClient/AnthropicUrlBuilder.cs`
- Modify: `llm-wiki-server/src/LlmWiki.Api/Infrastructure/LlmClient/LlmHttpClient.cs`
- Create: `llm-wiki-server/tests/LlmWiki.Api.Tests/AnthropicUrlBuilderTests.cs`

- [ ] **Step 1: 创建 AnthropicUrlBuilder**

```csharp
// llm-wiki-server/src/LlmWiki.Api/Infrastructure/LlmClient/AnthropicUrlBuilder.cs
using System.Text.RegularExpressions;

namespace LlmWiki.Api.Infrastructure.LlmClient;

public static partial class AnthropicUrlBuilder
{
    // 已包含 /vN/messages → 原样返回
    // 已包含 /vN         → 追加 /messages
    // 其他（裸 host、/anthropic 等）→ 追加 /v1/messages
    public static string Build(string baseUrl)
    {
        var trimmed = baseUrl.TrimEnd('/');
        if (VersionMessages().IsMatch(trimmed)) return trimmed;
        if (VersionOnly().IsMatch(trimmed)) return trimmed + "/messages";
        return trimmed + "/v1/messages";
    }

    [GeneratedRegex(@"/v\d+/messages$", RegexOptions.IgnoreCase)]
    private static partial Regex VersionMessages();

    [GeneratedRegex(@"/v\d+$", RegexOptions.IgnoreCase)]
    private static partial Regex VersionOnly();
}
```

- [ ] **Step 2: 编写 AnthropicUrlBuilder 测试**

```csharp
// llm-wiki-server/tests/LlmWiki.Api.Tests/AnthropicUrlBuilderTests.cs
using LlmWiki.Api.Infrastructure.LlmClient;

namespace LlmWiki.Api.Tests;

public class AnthropicUrlBuilderTests
{
    [Theory]
    [InlineData("https://api.anthropic.com", "https://api.anthropic.com/v1/messages")]
    [InlineData("https://api.anthropic.com/v1", "https://api.anthropic.com/v1/messages")]
    [InlineData("https://api.anthropic.com/v1/messages", "https://api.anthropic.com/v1/messages")]
    [InlineData("https://api.anthropic.com/v1/", "https://api.anthropic.com/v1/messages")]
    [InlineData("https://proxy.example.com/anthropic", "https://proxy.example.com/anthropic/v1/messages")]
    [InlineData("https://api.example.com/api/paas/v4", "https://api.example.com/api/paas/v4/messages")]
    public void Build_VariousInputs_ReturnsCorrectUrl(string input, string expected)
        => Assert.Equal(expected, AnthropicUrlBuilder.Build(input));
}
```

- [ ] **Step 3: 运行测试**

```bash
cd llm-wiki-server
dotnet test tests/LlmWiki.Api.Tests --filter "AnthropicUrlBuilderTests"
```

预期：`6 passed`

- [ ] **Step 4: 在 LlmHttpClient 中添加 Anthropic 分支**

在 `LlmHttpClient.cs` 中，在 `StreamOpenAiCompatAsync` 方法之后添加：

```csharp
    private async IAsyncEnumerable<string> StreamAnthropicAsync(
        LlmConfig config,
        IEnumerable<ChatMessage> messages,
        LlmOptions options,
        [EnumeratorCancellation] CancellationToken ct)
    {
        var url = AnthropicUrlBuilder.Build(config.Endpoint);
        var msgList = messages.ToList();
        var system = string.Join("\n", msgList
            .Where(m => m.Role == "system")
            .Select(m => m.Content));
        var conversation = msgList
            .Where(m => m.Role != "system")
            .Select(m => new { role = m.Role, content = m.Content });

        var body = new Dictionary<string, object>
        {
            ["model"] = config.Model,
            ["messages"] = conversation,
            ["stream"] = true,
            ["max_tokens"] = options.MaxTokens,
        };
        if (!string.IsNullOrEmpty(system)) body["system"] = system;

        using var request = new HttpRequestMessage(HttpMethod.Post, url);
        // MiniMax 等代理用 Bearer；标准 Anthropic 用 x-api-key
        var requiresBearer = url.Contains("minimax", StringComparison.OrdinalIgnoreCase)
                          || url.Contains("dashscope", StringComparison.OrdinalIgnoreCase);
        if (requiresBearer)
            request.Headers.Authorization =
                new AuthenticationHeaderValue("Bearer", config.EncryptedApiKey);
        else
        {
            request.Headers.Add("x-api-key", config.EncryptedApiKey);
            request.Headers.Add("anthropic-version", "2023-06-01");
        }
        request.Content = new StringContent(
            JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");

        using var response = await http.SendAsync(
            request, HttpCompletionOption.ResponseHeadersRead, ct);
        response.EnsureSuccessStatusCode();

        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        using var reader = new StreamReader(stream);

        string? currentEvent = null;
        while (!reader.EndOfStream && !ct.IsCancellationRequested)
        {
            var line = await reader.ReadLineAsync(ct);
            if (line is null) break;

            if (line.StartsWith("event:"))
            {
                currentEvent = line[6..].Trim();
                if (currentEvent == "message_stop") yield break;
                continue;
            }

            if (line.StartsWith("data:") && currentEvent == "content_block_delta")
            {
                var token = ParseAnthropicDeltaLine(line);
                if (token != null) yield return token;
            }
        }
    }

    internal static string? ParseAnthropicDeltaLine(string line)
    {
        if (!line.StartsWith("data: ")) return null;
        var data = line[6..].Trim();
        try
        {
            using var doc = JsonDocument.Parse(data);
            var root = doc.RootElement;
            if (root.TryGetProperty("delta", out var delta) &&
                delta.TryGetProperty("type", out var type) &&
                type.GetString() == "text_delta" &&
                delta.TryGetProperty("text", out var text))
                return text.GetString();
            return null;
        }
        catch { return null; }
    }
```

同时在 `LlmHttpClientTests.cs` 添加：

```csharp
    [Fact]
    public void ParseAnthropicDeltaLine_TextDelta_ReturnsToken()
    {
        var line = """data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"world"}}""";
        Assert.Equal("world", LlmHttpClient.ParseAnthropicDeltaLine(line));
    }

    [Fact]
    public void ParseAnthropicDeltaLine_NonTextDelta_ReturnsNull()
    {
        var line = """data: {"type":"message_start","message":{}}""";
        Assert.Null(LlmHttpClient.ParseAnthropicDeltaLine(line));
    }
```

- [ ] **Step 5: 运行全部 LlmClient 测试**

```bash
cd llm-wiki-server
dotnet test tests/LlmWiki.Api.Tests --filter "LlmHttpClient|AnthropicUrl"
```

预期：`8 passed`

- [ ] **Step 6: Commit**

```bash
git add llm-wiki-server/src/LlmWiki.Api/Infrastructure/LlmClient/ \
        llm-wiki-server/tests/LlmWiki.Api.Tests/AnthropicUrlBuilderTests.cs \
        llm-wiki-server/tests/LlmWiki.Api.Tests/LlmHttpClientTests.cs
git commit -m "feat: Anthropic streaming branch + URL builder"
```

---

## Task 6: IngestEventBroadcaster

**Files:**
- Create: `llm-wiki-server/src/LlmWiki.Api/Infrastructure/IngestWorker/IngestEventBroadcaster.cs`
- Create: `llm-wiki-server/tests/LlmWiki.Api.Tests/IngestEventBroadcasterTests.cs`

- [ ] **Step 1: 创建 IngestEvent + IngestEventBroadcaster**

```csharp
// llm-wiki-server/src/LlmWiki.Api/Infrastructure/IngestWorker/IngestEventBroadcaster.cs
using System.Collections.Concurrent;
using System.Runtime.CompilerServices;
using System.Threading.Channels;

namespace LlmWiki.Api.Infrastructure.IngestWorker;

public record IngestEvent(
    long Id,
    Guid TaskId,
    string Step,       // "analyzing" | "generating" | "writing" | "done" | "failed"
    string Detail,
    DateTimeOffset Timestamp);

public class IngestEventBroadcaster
{
    // 每条 SSE 连接独立 Channel，key = connectionId
    private readonly ConcurrentDictionary<Guid, (Guid DeptId, Channel<IngestEvent> Ch)>
        _connections = new();

    // 近期 100 条事件缓冲，用于断线重连回放
    private readonly ConcurrentDictionary<Guid, LinkedList<IngestEvent>> _recentEvents = new();
    private readonly object _bufferLock = new();

    private long _eventCounter;

    public IngestEvent CreateEvent(Guid taskId, string step, string detail) =>
        new(Interlocked.Increment(ref _eventCounter), taskId, step, detail, DateTimeOffset.UtcNow);

    public void Publish(Guid deptId, IngestEvent evt)
    {
        // 更新近期事件缓冲（最多 100 条）
        var buf = _recentEvents.GetOrAdd(deptId, _ => new LinkedList<IngestEvent>());
        lock (_bufferLock)
        {
            buf.AddLast(evt);
            while (buf.Count > 100) buf.RemoveFirst();
        }

        foreach (var (_, (d, ch)) in _connections)
            if (d == deptId) ch.Writer.TryWrite(evt);
    }

    public async IAsyncEnumerable<IngestEvent> SubscribeAsync(
        Guid deptId,
        long lastEventId,
        [EnumeratorCancellation] CancellationToken ct)
    {
        var connId = Guid.NewGuid();
        var channel = Channel.CreateUnbounded<IngestEvent>();
        _connections[connId] = (deptId, channel);

        // 回放客户端断线期间错过的事件
        if (_recentEvents.TryGetValue(deptId, out var recent))
        {
            lock (_bufferLock)
            {
                foreach (var evt in recent.Where(e => e.Id > lastEventId))
                    channel.Writer.TryWrite(evt);
            }
        }

        try
        {
            await foreach (var evt in channel.Reader.ReadAllAsync(ct))
                yield return evt;
        }
        finally
        {
            _connections.TryRemove(connId, out _);
            channel.Writer.TryComplete();
        }
    }

    public int ConnectionCount(Guid deptId) =>
        _connections.Values.Count(v => v.DeptId == deptId);
}
```

- [ ] **Step 2: 编写测试**

```csharp
// llm-wiki-server/tests/LlmWiki.Api.Tests/IngestEventBroadcasterTests.cs
using LlmWiki.Api.Infrastructure.IngestWorker;

namespace LlmWiki.Api.Tests;

public class IngestEventBroadcasterTests
{
    [Fact]
    public async Task Publish_SingleSubscriber_ReceivesEvent()
    {
        var broadcaster = new IngestEventBroadcaster();
        var deptId = Guid.NewGuid();
        var taskId = Guid.NewGuid();

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(2));
        var received = new List<IngestEvent>();

        var subscribeTask = Task.Run(async () =>
        {
            await foreach (var evt in broadcaster.SubscribeAsync(deptId, 0, cts.Token))
            {
                received.Add(evt);
                cts.Cancel();  // 收到第一条后取消
            }
        });

        await Task.Delay(50); // 等订阅建立
        var evt = broadcaster.CreateEvent(taskId, "analyzing", "Step 1/2");
        broadcaster.Publish(deptId, evt);

        await subscribeTask.WaitAsync(TimeSpan.FromSeconds(3));
        Assert.Single(received);
        Assert.Equal("analyzing", received[0].Step);
    }

    [Fact]
    public async Task Publish_MultipleSubscribers_AllReceive()
    {
        var broadcaster = new IngestEventBroadcaster();
        var deptId = Guid.NewGuid();
        var taskId = Guid.NewGuid();
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(2));

        var counts = new int[2];
        var tasks = Enumerable.Range(0, 2).Select(i => Task.Run(async () =>
        {
            await foreach (var evt in broadcaster.SubscribeAsync(deptId, 0, cts.Token))
            {
                counts[i]++;
                cts.Cancel();
            }
        })).ToArray();

        await Task.Delay(50);
        broadcaster.Publish(deptId, broadcaster.CreateEvent(taskId, "done", "ok"));
        await Task.WhenAll(tasks.Select(t => t.WaitAsync(TimeSpan.FromSeconds(3))));

        Assert.All(counts, c => Assert.Equal(1, c));
    }

    [Fact]
    public async Task Subscribe_WithLastEventId_ReplaysMissedEvents()
    {
        var broadcaster = new IngestEventBroadcaster();
        var deptId = Guid.NewGuid();
        var taskId = Guid.NewGuid();

        // 发布 3 条事件，无订阅者
        var evt1 = broadcaster.CreateEvent(taskId, "s1", "d1");
        var evt2 = broadcaster.CreateEvent(taskId, "s2", "d2");
        var evt3 = broadcaster.CreateEvent(taskId, "s3", "d3");
        broadcaster.Publish(deptId, evt1);
        broadcaster.Publish(deptId, evt2);
        broadcaster.Publish(deptId, evt3);

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(2));
        var received = new List<IngestEvent>();

        // 订阅时 lastEventId = evt1.Id，应该只收到 evt2 和 evt3
        var task = Task.Run(async () =>
        {
            await foreach (var evt in broadcaster.SubscribeAsync(deptId, evt1.Id, cts.Token))
            {
                received.Add(evt);
                if (received.Count >= 2) cts.Cancel();
            }
        });

        await task.WaitAsync(TimeSpan.FromSeconds(3));
        Assert.Equal(2, received.Count);
        Assert.Equal("s2", received[0].Step);
        Assert.Equal("s3", received[1].Step);
    }
}
```

- [ ] **Step 3: 运行测试**

```bash
cd llm-wiki-server
dotnet test tests/LlmWiki.Api.Tests --filter "IngestEventBroadcasterTests"
```

预期：`3 passed`

- [ ] **Step 4: Commit**

```bash
git add llm-wiki-server/src/LlmWiki.Api/Infrastructure/IngestWorker/IngestEventBroadcaster.cs \
        llm-wiki-server/tests/LlmWiki.Api.Tests/IngestEventBroadcasterTests.cs
git commit -m "feat: IngestEventBroadcaster with per-connection channels and replay"
```

---

## Task 7: SseTokenService + SSE 端点

**Files:**
- Create: `llm-wiki-server/src/LlmWiki.Api/Infrastructure/IngestWorker/SseTokenService.cs`
- Create: `llm-wiki-server/src/LlmWiki.Api/Modules/Wiki/SseController.cs`

- [ ] **Step 1: 创建 SseTokenService**

```csharp
// llm-wiki-server/src/LlmWiki.Api/Infrastructure/IngestWorker/SseTokenService.cs
using System.Collections.Concurrent;
using System.Security.Cryptography;

namespace LlmWiki.Api.Infrastructure.IngestWorker;

public record SseTokenInfo(Guid UserId, Guid DeptId, DateTimeOffset ExpiresAt);

public class SseTokenService
{
    private readonly ConcurrentDictionary<string, SseTokenInfo> _tokens = new();
    private readonly TimeSpan _ttl = TimeSpan.FromMinutes(10);

    public string Issue(Guid userId, Guid deptId)
    {
        // 清理过期 token（机会性清理，不需要精确）
        var now = DateTimeOffset.UtcNow;
        foreach (var (k, v) in _tokens)
            if (v.ExpiresAt < now) _tokens.TryRemove(k, out _);

        var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
            .Replace('+', '-').Replace('/', '_').TrimEnd('=');
        _tokens[token] = new SseTokenInfo(userId, deptId, now.Add(_ttl));
        return token;
    }

    public SseTokenInfo? Validate(string token, Guid deptId)
    {
        if (!_tokens.TryGetValue(token, out var info)) return null;
        if (info.ExpiresAt < DateTimeOffset.UtcNow) { _tokens.TryRemove(token, out _); return null; }
        if (info.DeptId != deptId) return null;
        return info;
    }

    public void Revoke(Guid userId)
    {
        foreach (var (k, v) in _tokens)
            if (v.UserId == userId) _tokens.TryRemove(k, out _);
    }
}
```

- [ ] **Step 2: 创建 SseController**

```csharp
// llm-wiki-server/src/LlmWiki.Api/Modules/Wiki/SseController.cs
using LlmWiki.Api.Infrastructure;
using LlmWiki.Api.Infrastructure.IngestWorker;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System.Text;
using System.Text.Json;

namespace LlmWiki.Api.Modules.Wiki;

[ApiController]
[Authorize]
public class SseController(
    SseTokenService tokenService,
    IngestEventBroadcaster broadcaster,
    ICurrentUser currentUser,
    AppDbContext db) : ControllerBase
{
    /// <summary>POST /api/departments/{deptId}/events/token</summary>
    [HttpPost("api/departments/{deptId:guid}/events/token")]
    [RequireDeptRole]
    public IActionResult IssueToken(Guid deptId)
    {
        if (!currentUser.IsAuthenticated) return Unauthorized();
        var token = tokenService.Issue(currentUser.UserId!.Value, deptId);
        return Ok(new { token, expiresAt = DateTimeOffset.UtcNow.AddMinutes(10) });
    }

    /// <summary>GET /api/departments/{deptId}/events?token=...&amp;lastEventId=...</summary>
    [HttpGet("api/departments/{deptId:guid}/events")]
    [AllowAnonymous] // 鉴权由 token 完成
    public async Task StreamEvents(
        Guid deptId,
        [FromQuery] string token,
        [FromQuery] long lastEventId = 0,
        CancellationToken ct = default)
    {
        var info = tokenService.Validate(token, deptId);
        if (info is null)
        {
            Response.StatusCode = 401;
            return;
        }

        Response.Headers.ContentType = "text/event-stream";
        Response.Headers.CacheControl = "no-cache";
        Response.Headers.Connection = "keep-alive";

        // 断线前的 DB 快照作为初始状态
        var running = await db.IngestTasks
            .Where(t => t.DepartmentId == deptId &&
                        (t.Status == "running" || t.Status == "queued"))
            .Select(t => new { t.Id, t.Status, t.ProgressDetail })
            .ToListAsync(ct);

        foreach (var task in running)
        {
            var snapshot = JsonSerializer.Serialize(new
            {
                taskId = task.Id,
                step = task.Status,
                detail = task.ProgressDetail ?? "",
                isSnapshot = true,
            });
            await WriteEventAsync(0, snapshot, ct);
        }

        await foreach (var evt in broadcaster.SubscribeAsync(deptId, lastEventId, ct))
        {
            var json = JsonSerializer.Serialize(new
            {
                taskId = evt.TaskId,
                step = evt.Step,
                detail = evt.Detail,
                timestamp = evt.Timestamp,
            });
            await WriteEventAsync(evt.Id, json, ct);
        }
    }

    private async Task WriteEventAsync(long id, string data, CancellationToken ct)
    {
        var bytes = Encoding.UTF8.GetBytes($"id: {id}\ndata: {data}\n\n");
        await Response.Body.WriteAsync(bytes, ct);
        await Response.Body.FlushAsync(ct);
    }
}
```

- [ ] **Step 3: 编译验证**

```bash
cd llm-wiki-server
dotnet build src/LlmWiki.Api/LlmWiki.Api.csproj
```

预期：`Build succeeded.`

- [ ] **Step 4: Commit**

```bash
git add llm-wiki-server/src/LlmWiki.Api/Infrastructure/IngestWorker/SseTokenService.cs \
        llm-wiki-server/src/LlmWiki.Api/Modules/Wiki/SseController.cs
git commit -m "feat: SseTokenService + SSE events endpoint"
```

---

## Task 8: IngestPipelineService

**Files:**
- Create: `llm-wiki-server/src/LlmWiki.Api/Infrastructure/IngestWorker/IngestPipelineService.cs`
- Create: `llm-wiki-server/tests/LlmWiki.Api.Tests/IngestPipelineServiceTests.cs`

- [ ] **Step 1: 编写 ParseFileBlocks 测试（先写测试）**

```csharp
// llm-wiki-server/tests/LlmWiki.Api.Tests/IngestPipelineServiceTests.cs
using LlmWiki.Api.Infrastructure.IngestWorker;

namespace LlmWiki.Api.Tests;

public class ParseFileBlocksTests
{
    [Fact]
    public void ParseFileBlocks_SingleBlock_ExtractsCorrectly()
    {
        var text = "---FILE: wiki/concepts/foo.md---\nHello\n---END FILE---";
        var result = IngestPipelineService.ParseFileBlocks(text);
        Assert.Single(result.Blocks);
        Assert.Equal("wiki/concepts/foo.md", result.Blocks[0].Path);
        Assert.Equal("Hello", result.Blocks[0].Content.Trim());
    }

    [Fact]
    public void ParseFileBlocks_UnclosedBlock_ReturnsWarning()
    {
        var text = "---FILE: wiki/concepts/foo.md---\nHello";
        var result = IngestPipelineService.ParseFileBlocks(text);
        Assert.Empty(result.Blocks);
        Assert.Single(result.Warnings);
    }

    [Fact]
    public void ParseFileBlocks_PathTraversal_Rejected()
    {
        var text = "---FILE: ../../../etc/passwd---\nbad\n---END FILE---";
        var result = IngestPipelineService.ParseFileBlocks(text);
        Assert.Empty(result.Blocks);
        Assert.Single(result.Warnings);
    }

    [Fact]
    public void ParseFileBlocks_NotUnderWiki_Rejected()
    {
        var text = "---FILE: raw/bad.md---\nbad\n---END FILE---";
        var result = IngestPipelineService.ParseFileBlocks(text);
        Assert.Empty(result.Blocks);
    }

    [Fact]
    public void ParseFileBlocks_EndFileInsideFence_NotClosedEarly()
    {
        var text = "---FILE: wiki/concepts/foo.md---\n```\n---END FILE---\n```\n---END FILE---";
        var result = IngestPipelineService.ParseFileBlocks(text);
        Assert.Single(result.Blocks);
        // 内容应包含 fence 内的 ---END FILE---
        Assert.Contains("---END FILE---", result.Blocks[0].Content);
    }

    [Fact]
    public void ParseFileBlocks_CrlfLineEndings_Handled()
    {
        var text = "---FILE: wiki/concepts/foo.md---\r\nHello\r\n---END FILE---";
        var result = IngestPipelineService.ParseFileBlocks(text);
        Assert.Single(result.Blocks);
    }
}
```

- [ ] **Step 2: 运行测试（预期全部失败）**

```bash
cd llm-wiki-server
dotnet test tests/LlmWiki.Api.Tests --filter "ParseFileBlocksTests"
```

预期：编译失败（`IngestPipelineService` 还不存在）

- [ ] **Step 3: 创建 IngestPipelineService（含 ParseFileBlocks）**

```csharp
// llm-wiki-server/src/LlmWiki.Api/Infrastructure/IngestWorker/IngestPipelineService.cs
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using LlmWiki.Api.Infrastructure.LlmClient;
using LlmWiki.Api.Modules.Wiki.Entities;
using LlmWiki.Api.Services;

namespace LlmWiki.Api.Infrastructure.IngestWorker;

public record ParsedFileBlock(string Path, string Content);
public record ParseFileBlocksResult(IReadOnlyList<ParsedFileBlock> Blocks, IReadOnlyList<string> Warnings);

public class IngestPipelineService(
    ILlmClient llmClient,
    FileService fileService,
    LlmConfigService llmConfigService,
    IngestEventBroadcaster broadcaster,
    AppDbContext db)
{
    private static readonly Regex OpenerLine =
        new(@"^---\s*FILE:\s*(.+?)\s*---\s*$", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex CloserLine =
        new(@"^---\s*END\s+FILE\s*---\s*$", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex FenceLine =
        new(@"^\s{0,3}(```+|~~~+)", RegexOptions.Compiled);

    public static ParseFileBlocksResult ParseFileBlocks(string text)
    {
        var normalized = text.Replace("\r\n", "\n");
        var lines = normalized.Split('\n');
        var blocks = new List<ParsedFileBlock>();
        var warnings = new List<string>();
        int i = 0;

        while (i < lines.Length)
        {
            var openerMatch = OpenerLine.Match(lines[i]);
            if (!openerMatch.Success) { i++; continue; }

            var path = openerMatch.Groups[1].Value.Trim();
            i++;

            var contentLines = new List<string>();
            string? fenceMarker = null;
            int fenceLen = 0;
            bool closed = false;

            while (i < lines.Length)
            {
                var line = lines[i];
                var fenceMatch = FenceLine.Match(line);
                if (fenceMatch.Success)
                {
                    var run = fenceMatch.Groups[1].Value;
                    var ch = run[0]; var len = run.Length;
                    if (fenceMarker == null) { fenceMarker = ch.ToString(); fenceLen = len; }
                    else if (ch.ToString() == fenceMarker && len >= fenceLen) { fenceMarker = null; fenceLen = 0; }
                    contentLines.Add(line); i++; continue;
                }

                if (fenceMarker == null && CloserLine.IsMatch(line))
                { closed = true; i++; break; }

                contentLines.Add(line); i++;
            }

            if (!closed)
            {
                var msg = $"FILE block \"{(string.IsNullOrEmpty(path) ? "(unnamed)" : path)}\" not closed — likely stream truncation.";
                warnings.Add(msg); continue;
            }
            if (string.IsNullOrWhiteSpace(path))
            {
                warnings.Add("FILE block with empty path skipped."); continue;
            }
            if (!IsSafePath(path))
            {
                warnings.Add($"FILE block with unsafe path \"{path}\" rejected."); continue;
            }

            blocks.Add(new ParsedFileBlock(path, string.Join("\n", contentLines)));
        }

        return new ParseFileBlocksResult(blocks, warnings);
    }

    private static bool IsSafePath(string p)
    {
        if (string.IsNullOrWhiteSpace(p)) return false;
        if (p.Contains('\x00')) return false;
        if (p.StartsWith('/') || p.StartsWith('\\')) return false;
        if (Regex.IsMatch(p, @"^[a-zA-Z]:")) return false;
        var norm = p.Replace('\\', '/');
        if (norm.Split('/').Any(s => s == "..")) return false;
        if (!norm.StartsWith("wiki/")) return false;
        return true;
    }

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

        async Task UpdateProgress(string step, string detail)
        {
            await db.IngestTasks
                .Where(t => t.Id == task.Id)
                .ExecuteUpdateAsync(s => s.SetProperty(t => t.ProgressDetail, detail), ct);
            broadcaster.Publish(deptId, broadcaster.CreateEvent(task.Id, step, detail));
        }

        try
        {
            // 解析 LlmConfig（TriggeredBy 用户级 → 部门级）
            LlmConfig? config = null;
            if (task.TriggeredBy.HasValue)
                config = await db.LlmConfigs
                    .Where(c => c.UserId == task.TriggeredBy && c.IsActive)
                    .FirstOrDefaultAsync(ct);
            config ??= await db.LlmConfigs
                .Where(c => c.DepartmentId == deptId && c.IsActive)
                .FirstOrDefaultAsync(ct);

            if (config is null)
                throw new InvalidOperationException("LLM not configured for this user or department");

            // 解密 API Key（交给 LlmClient 使用）
            var runtimeConfig = config with
            {
                EncryptedApiKey = llmConfigService.DecryptIfNotEmpty(config.EncryptedApiKey)
            };

            // 读取源文件 + 项目元文件
            await UpdateProgress("reading", "Reading source file...");
            var sourcePath = task.SourceFilePath;
            var sourceContent = await TryReadFileAsync(sourcePath);
            var projectRoot = GetProjectRoot(sourcePath);

            var (purpose, index, schema, overview) = await ReadMetaFilesAsync(projectRoot, ct);

            // 检查 ingest cache
            var cacheHit = await CheckIngestCacheAsync(projectRoot, task.SourceFileName, sourceContent);
            if (cacheHit is not null)
            {
                await MarkDone(task.Id, cacheHit.Count, "Skipped (cached)", ct);
                broadcaster.Publish(deptId, broadcaster.CreateEvent(task.Id, "done",
                    $"Skipped (unchanged) — {cacheHit.Count} cached files"));
                return;
            }

            // 截断源内容
            var maxChars = runtimeConfig.MaxContextSize * 3; // rough chars estimate
            var truncated = sourceContent.Length > maxChars
                ? sourceContent[..maxChars] + "\n\n[...truncated...]"
                : sourceContent;

            // Step 1: 分析
            await UpdateProgress("analyzing", "Step 1/2: Analyzing source...");
            var analysis = new StringBuilder();
            var analysisMessages = new[]
            {
                new ChatMessage("system", BuildAnalysisPrompt(purpose, index, truncated)),
                new ChatMessage("user", $"Analyze this source document:\n\n**File:** {task.SourceFileName}\n\n---\n\n{truncated}"),
            };
            await foreach (var token in llmClient.StreamChatAsync(
                runtimeConfig, analysisMessages, new LlmOptions(0.1f, 4096), ct))
                analysis.Append(token);

            // Step 2: 生成
            await UpdateProgress("generating", "Step 2/2: Generating wiki pages...");
            var generation = new StringBuilder();
            var genMessages = new[]
            {
                new ChatMessage("system", BuildGenerationPrompt(schema, purpose, index, task.SourceFileName, overview, truncated)),
                new ChatMessage("user", string.Join("\n", [
                    $"Source document to process: **{task.SourceFileName}**",
                    "",
                    "The Stage 1 analysis below is CONTEXT only. Do NOT echo it. Your output must be FILE blocks as specified.",
                    "",
                    "## Stage 1 Analysis (context only — do not repeat)",
                    "",
                    analysis.ToString(),
                    "",
                    "## Original Source Content",
                    "",
                    truncated,
                    "",
                    "---",
                    "",
                    $"Now emit the FILE blocks for the wiki files derived from **{task.SourceFileName}**.",
                    "Your response MUST begin with `---FILE:` as the very first characters.",
                ])),
            };
            await foreach (var token in llmClient.StreamChatAsync(
                runtimeConfig, genMessages, new LlmOptions(0.1f, 8192), ct))
                generation.Append(token);

            // 解析 + 写文件
            await UpdateProgress("writing", "Writing files...");
            var parseResult = ParseFileBlocks(generation.ToString());
            var writtenPaths = new List<string>();

            foreach (var block in parseResult.Blocks)
            {
                var fullPath = Path.Combine(projectRoot, block.Path.Replace('/', Path.DirectorySeparatorChar));
                await WriteWikiFileAsync(fullPath, block.Path, block.Content, task.SourceFileName);
                writtenPaths.Add(block.Path);
            }

            // 保证 source summary 页存在
            var sourceBaseName = Path.GetFileNameWithoutExtension(task.SourceFileName);
            var sourceSummaryPath = $"wiki/sources/{sourceBaseName}.md";
            if (!writtenPaths.Any(p => p.StartsWith("wiki/sources/")))
            {
                var date = DateTime.UtcNow.ToString("yyyy-MM-dd");
                var fallback = $"---\ntype: source\ntitle: \"Source: {task.SourceFileName}\"\ncreated: {date}\nupdated: {date}\nsources: [\"{task.SourceFileName}\"]\ntags: []\nrelated: []\n---\n\n# Source: {task.SourceFileName}\n\n{analysis.ToString()[..Math.Min(3000, analysis.Length)]}\n";
                await WriteRawFileAsync(Path.Combine(projectRoot, sourceSummaryPath.Replace('/', Path.DirectorySeparatorChar)), fallback);
                writtenPaths.Add(sourceSummaryPath);
            }

            // 写 ingest cache
            if (writtenPaths.Count > 0)
                await SaveIngestCacheAsync(projectRoot, task.SourceFileName, sourceContent, writtenPaths);

            await MarkDone(task.Id, writtenPaths.Count,
                $"{writtenPaths.Count} files written", ct);
            broadcaster.Publish(deptId, broadcaster.CreateEvent(task.Id, "done",
                $"{writtenPaths.Count} files written"));
        }
        catch (Exception ex) when (!ct.IsCancellationRequested)
        {
            var msg = ex.Message.Length > 500 ? ex.Message[..500] : ex.Message;
            await db.IngestTasks
                .Where(t => t.Id == task.Id)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(t => t.Status, "failed")
                    .SetProperty(t => t.ErrorMessage, msg)
                    .SetProperty(t => t.CompletedAt, DateTime.UtcNow), ct);
            broadcaster.Publish(deptId, broadcaster.CreateEvent(task.Id, "failed", msg));
            throw;
        }
    }

    private async Task MarkDone(Guid taskId, int pageCount, string detail, CancellationToken ct) =>
        await db.IngestTasks
            .Where(t => t.Id == taskId)
            .ExecuteUpdateAsync(s => s
                .SetProperty(t => t.Status, "done")
                .SetProperty(t => t.WikiPagesCount, pageCount)
                .SetProperty(t => t.ProgressDetail, detail)
                .SetProperty(t => t.CompletedAt, DateTime.UtcNow), ct);

    // ── File I/O helpers ──────────────────────────────────────────────────

    private static string GetProjectRoot(string sourcePath)
    {
        // 源文件在 <projectRoot>/raw/... 或 <projectRoot>/...
        // 向上查找包含 wiki/ 目录的根
        var dir = Path.GetDirectoryName(Path.GetFullPath(sourcePath)) ?? "";
        while (!string.IsNullOrEmpty(dir))
        {
            if (Directory.Exists(Path.Combine(dir, "wiki"))) return dir;
            dir = Path.GetDirectoryName(dir) ?? "";
        }
        return Path.GetDirectoryName(Path.GetFullPath(sourcePath)) ?? "";
    }

    private async Task<string> TryReadFileAsync(string path)
    {
        try { return await fileService.ReadFileAsync(path); }
        catch { return ""; }
    }

    private async Task<(string purpose, string index, string schema, string overview)>
        ReadMetaFilesAsync(string root, CancellationToken ct)
    {
        async Task<string> TryRead(string rel)
        {
            try { return await fileService.ReadFileAsync(Path.Combine(root, rel)); }
            catch { return ""; }
        }
        var results = await Task.WhenAll(
            TryRead("purpose.md"), TryRead("wiki/index.md"),
            TryRead("schema.md"), TryRead("wiki/overview.md"));
        return (results[0], results[1], results[2], results[3]);
    }

    private async Task WriteWikiFileAsync(
        string fullPath, string relativePath, string content, string sourceFileName)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(fullPath)!);

        if (relativePath == "wiki/log.md")
        {
            // log.md：按来源去重替换，不重复追加
            await WriteLogEntryAsync(fullPath, content, sourceFileName);
            return;
        }
        await File.WriteAllTextAsync(fullPath, content);
    }

    private static async Task WriteLogEntryAsync(string fullPath, string newEntry, string sourceFileName)
    {
        var existing = File.Exists(fullPath) ? await File.ReadAllTextAsync(fullPath) : "";
        // 找到并替换已有的同名 source 条目，否则追加
        var marker = $"## [";
        var sourceTag = sourceFileName.Replace("[", "").Replace("]", "");
        // 匹配包含 sourceFileName 的 ## [...] 行
        var pattern = new Regex($@"##\s*\[.*?\].*{Regex.Escape(sourceTag)}.*(\n(?!##).*)*",
            RegexOptions.IgnoreCase);
        var updated = pattern.IsMatch(existing)
            ? pattern.Replace(existing, newEntry.Trim())
            : (string.IsNullOrEmpty(existing) ? newEntry : existing.TrimEnd() + "\n\n" + newEntry);
        await File.WriteAllTextAsync(fullPath, updated);
    }

    private static Task WriteRawFileAsync(string fullPath, string content)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(fullPath)!);
        return File.WriteAllTextAsync(fullPath, content);
    }

    // ── Ingest cache ──────────────────────────────────────────────────────

    private record CacheEntry(string Hash, long Timestamp, List<string> FilesWritten);
    private record CacheData(Dictionary<string, CacheEntry> Entries);

    private static string CachePath(string projectRoot) =>
        Path.Combine(projectRoot, ".llm-wiki", "ingest-cache.json");

    private static string Sha256(string content)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(content));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }

    private async Task<List<string>?> CheckIngestCacheAsync(
        string projectRoot, string sourceFileName, string sourceContent)
    {
        try
        {
            var path = CachePath(projectRoot);
            if (!File.Exists(path)) return null;
            var raw = await File.ReadAllTextAsync(path);
            var data = JsonSerializer.Deserialize<CacheData>(raw,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            if (data?.Entries.TryGetValue(sourceFileName, out var entry) != true) return null;
            if (entry.Hash != Sha256(sourceContent)) return null;
            // 验证所有文件仍存在
            foreach (var f in entry.FilesWritten)
                if (!File.Exists(Path.Combine(projectRoot, f.Replace('/', Path.DirectorySeparatorChar))))
                    return null;
            return entry.FilesWritten;
        }
        catch { return null; }
    }

    private async Task SaveIngestCacheAsync(
        string projectRoot, string sourceFileName, string sourceContent, List<string> writtenPaths)
    {
        try
        {
            var path = CachePath(projectRoot);
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            CacheData data;
            if (File.Exists(path))
            {
                var raw = await File.ReadAllTextAsync(path);
                data = JsonSerializer.Deserialize<CacheData>(raw,
                    new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
                    ?? new CacheData(new());
            }
            else data = new CacheData(new());

            data.Entries[sourceFileName] = new CacheEntry(
                Sha256(sourceContent),
                DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                writtenPaths);
            await File.WriteAllTextAsync(path,
                JsonSerializer.Serialize(data, new JsonSerializerOptions { WriteIndented = true }));
        }
        catch { /* non-critical */ }
    }

    // ── Prompt builders ───────────────────────────────────────────────────
    // 从 src/lib/ingest.ts 的 buildAnalysisPrompt / buildGenerationPrompt 移植

    private static string BuildAnalysisPrompt(string purpose, string index, string sourceContent)
    {
        var parts = new List<string>
        {
            "You are an expert research analyst. Read the source document and produce a structured analysis.",
            "Do not output chain-of-thought, hidden reasoning, or a thinking transcript. Reason internally and write only the concise final analysis.",
            "",
            "Your analysis should cover:",
            "",
            "## Key Entities",
            "List people, organizations, products, datasets, tools mentioned. For each:",
            "- Name and type",
            "- Role in the source (central vs. peripheral)",
            "- Whether it likely already exists in the wiki (check the index)",
            "",
            "## Key Concepts",
            "List theories, methods, techniques, phenomena. For each:",
            "- Name and brief definition",
            "- Why it matters in this source",
            "- Whether it likely already exists in the wiki",
            "",
            "## Main Arguments & Findings",
            "- What are the core claims or results?",
            "- What evidence supports them?",
            "- How strong is the evidence?",
            "",
            "## Connections to Existing Wiki",
            "- What existing pages does this source relate to?",
            "- Does it strengthen, challenge, or extend existing knowledge?",
            "",
            "## Contradictions & Tensions",
            "- Does anything in this source conflict with existing wiki content?",
            "- Are there internal tensions or caveats?",
            "",
            "## Recommendations",
            "- What wiki pages should be created or updated?",
            "- What should be emphasized vs. de-emphasized?",
            "- Any open questions worth flagging for the user?",
            "",
            "Be thorough but concise. Focus on what's genuinely important.",
            "",
            "If a folder context is provided, use it as a hint for categorization.",
        };
        if (!string.IsNullOrEmpty(purpose))
            parts.Add($"\n## Wiki Purpose (for context)\n{purpose}");
        if (!string.IsNullOrEmpty(index))
            parts.Add($"\n## Current Wiki Index (for checking existing content)\n{index}");
        return string.Join("\n", parts);
    }

    private static string BuildGenerationPrompt(
        string schema, string purpose, string index,
        string sourceFileName, string overview, string sourceContent)
    {
        var sourceBaseName = Path.GetFileNameWithoutExtension(sourceFileName);
        var parts = new List<string>
        {
            "You are a wiki maintainer. Based on the analysis provided, generate wiki files.",
            "Do not output chain-of-thought, hidden reasoning, or explanatory preamble. Output only the requested FILE blocks.",
            "",
            $"## IMPORTANT: Source File",
            $"The original source file is: **{sourceFileName}**",
            $"All wiki pages generated from this source MUST include this filename in their frontmatter `sources` field.",
            "",
            "## What to generate",
            "",
            $"1. A source summary page at **wiki/sources/{sourceBaseName}.md** (MUST use this exact path)",
            "2. Entity pages in wiki/entities/ for key entities identified in the analysis",
            "3. Concept pages in wiki/concepts/ for key concepts identified in the analysis",
            "4. An updated wiki/index.md — add new entries to existing categories, preserve all existing entries",
            "5. A log entry for wiki/log.md (just the new entry, format: ## [YYYY-MM-DD] ingest | Title)",
            "6. An updated wiki/overview.md — comprehensive 2-5 paragraph overview of ALL topics in the wiki",
            "",
            "## Frontmatter Rules (CRITICAL — parser is strict)",
            "",
            "Every page begins with a YAML frontmatter block:",
            "1. The VERY FIRST line MUST be exactly `---`",
            "2. Required fields: type, title, created, updated, tags, related, sources",
            "3. Arrays use inline YAML form: `tags: [a, b, c]`",
            $"4. sources MUST include \"{sourceFileName}\"",
            "",
            "## Output Format",
            "Wrap each file in:",
            "---FILE: wiki/path/name.md---",
            "<file content>",
            "---END FILE---",
        };
        if (!string.IsNullOrEmpty(schema))
            parts.Add($"\n## Wiki Schema\n{schema}");
        if (!string.IsNullOrEmpty(purpose))
            parts.Add($"\n## Wiki Purpose\n{purpose}");
        if (!string.IsNullOrEmpty(index))
            parts.Add($"\n## Current Wiki Index\n{index}");
        if (!string.IsNullOrEmpty(overview))
            parts.Add($"\n## Current Wiki Overview\n{overview}");
        return string.Join("\n", parts);
    }
}
```

- [ ] **Step 4: 运行 ParseFileBlocks 测试**

```bash
cd llm-wiki-server
dotnet test tests/LlmWiki.Api.Tests --filter "ParseFileBlocksTests"
```

预期：`6 passed`

- [ ] **Step 5: Commit**

```bash
git add llm-wiki-server/src/LlmWiki.Api/Infrastructure/IngestWorker/IngestPipelineService.cs \
        llm-wiki-server/tests/LlmWiki.Api.Tests/IngestPipelineServiceTests.cs
git commit -m "feat: IngestPipelineService with 2-step LLM pipeline and file writing"
```

---

## Task 9: IIngestQueue + IngestWorkerService

**Files:**
- Create: `llm-wiki-server/src/LlmWiki.Api/Infrastructure/IngestWorker/IIngestQueue.cs`
- Create: `llm-wiki-server/src/LlmWiki.Api/Infrastructure/IngestWorker/IngestWorkerService.cs`

- [ ] **Step 1: 创建 IIngestQueue**

```csharp
// llm-wiki-server/src/LlmWiki.Api/Infrastructure/IngestWorker/IIngestQueue.cs
namespace LlmWiki.Api.Infrastructure.IngestWorker;

public interface IIngestQueue
{
    /// <summary>通知 worker 有新任务。信号模式，幂等，不阻塞。</summary>
    void Signal();
}
```

- [ ] **Step 2: 创建 IngestWorkerService**

```csharp
// llm-wiki-server/src/LlmWiki.Api/Infrastructure/IngestWorker/IngestWorkerService.cs
using System.Threading.Channels;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace LlmWiki.Api.Infrastructure.IngestWorker;

public class IngestWorkerService(
    IServiceScopeFactory scopeFactory,
    ILogger<IngestWorkerService> logger)
    : BackgroundService, IIngestQueue
{
    // 容量 1，DropWrite：重复信号丢弃，不阻塞
    private readonly Channel<byte> _signal =
        Channel.CreateBounded<byte>(new BoundedChannelOptions(1)
        {
            FullMode = BoundedChannelFullMode.DropWrite,
            SingleReader = true,
        });

    // 健康检查用内存字段
    public DateTime? LastCompletedAt { get; private set; }
    public Guid? CurrentTaskId { get; private set; }
    public bool IsAlive { get; private set; }

    public void Signal() => _signal.Writer.TryWrite(0);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        IsAlive = true;
        logger.LogInformation("[IngestWorker] Starting...");

        // 启动时：将崩溃中的 running 任务重置为 queued
        await using (var scope = scopeFactory.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var reset = await db.IngestTasks
                .Where(t => t.Status == "running")
                .ExecuteUpdateAsync(s => s.SetProperty(t => t.Status, "queued"), stoppingToken);
            if (reset > 0)
                logger.LogWarning("[IngestWorker] Reset {Count} interrupted tasks to queued", reset);
        }

        // 有 queued 任务则立即触发
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
                task = await db.IngestTasks
                    .Where(t => t.Status == "queued")
                    .OrderBy(t => t.QueuedAt)
                    .FirstOrDefaultAsync(ct);
            }

            if (task is null) break;

            CurrentTaskId = task.Id;
            logger.LogInformation("[IngestWorker] Processing task {TaskId} ({File})",
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
}
```

- [ ] **Step 3: 编译验证**

```bash
cd llm-wiki-server
dotnet build src/LlmWiki.Api/LlmWiki.Api.csproj
```

预期：`Build succeeded.`

- [ ] **Step 4: Commit**

```bash
git add llm-wiki-server/src/LlmWiki.Api/Infrastructure/IngestWorker/IIngestQueue.cs \
        llm-wiki-server/src/LlmWiki.Api/Infrastructure/IngestWorker/IngestWorkerService.cs
git commit -m "feat: IngestWorkerService with signal channel and crash recovery"
```

---

## Task 10: Program.cs 全量注册 + Health check + IngestTaskController 更新

**Files:**
- Modify: `llm-wiki-server/src/LlmWiki.Api/Program.cs`
- Modify: `llm-wiki-server/src/LlmWiki.Api/Modules/Wiki/IngestTaskController.cs`

- [ ] **Step 1: 更新 IngestTaskController，Create 后调用 Signal**

在 `IngestTaskController.cs` 的构造函数参数中添加 `IIngestQueue ingestQueue`，在 `Create` 方法的 `return CreatedAtAction(...)` 之前插入：

```csharp
        db.IngestTasks.Add(task);
        await db.SaveChangesAsync();

        // 通知 Worker 有新任务
        ingestQueue.Signal();

        return CreatedAtAction(nameof(List), new { deptId }, ToResponse(task));
```

同时添加 `using LlmWiki.Api.Infrastructure.IngestWorker;` 到文件顶部。

- [ ] **Step 2: 在 Program.cs 中注册所有新服务**

在 `builder.Services.AddSingleton<CloudWikiService>();` 之后添加：

```csharp
// Ingest Worker 基础设施
builder.Services.AddHttpClient<ILlmClient, LlmHttpClient>();
builder.Services.AddSingleton<IngestEventBroadcaster>();
builder.Services.AddSingleton<SseTokenService>();
builder.Services.AddScoped<IngestPipelineService>();
builder.Services.AddSingleton<LlmConfigService>();

// Worker 作为 IHostedService + IIngestQueue（单例）
builder.Services.AddSingleton<IngestWorkerService>();
builder.Services.AddSingleton<IIngestQueue>(sp => sp.GetRequiredService<IngestWorkerService>());
builder.Services.AddHostedService(sp => sp.GetRequiredService<IngestWorkerService>());
```

同时添加必要的 using：

```csharp
using LlmWiki.Api.Infrastructure.LlmClient;
using LlmWiki.Api.Infrastructure.IngestWorker;
```

- [ ] **Step 3: 添加 Worker 健康检查端点**

在 `app.MapGet("/health", ...)` 之后添加：

```csharp
app.MapGet("/api/health/ingest-worker", (IngestWorkerService worker) =>
    Results.Ok(new
    {
        workerAlive = worker.IsAlive,
        channelBacklog = 0, // 信号 Channel，有意义的积压量查 DB
        lastCompletedAt = worker.LastCompletedAt,
        currentTaskId = worker.CurrentTaskId,
    }));
```

- [ ] **Step 4: 编译并运行全量测试**

```bash
cd llm-wiki-server
dotnet build src/LlmWiki.Api/LlmWiki.Api.csproj
dotnet test tests/LlmWiki.Api.Tests
```

预期：`Build succeeded.` 且已有测试全部通过。

- [ ] **Step 5: Commit**

```bash
git add llm-wiki-server/src/LlmWiki.Api/Program.cs \
        llm-wiki-server/src/LlmWiki.Api/Modules/Wiki/IngestTaskController.cs
git commit -m "feat: wire all ingest services in Program.cs, add worker health endpoint"
```

---

## Task 11: Docker key ring 挂载 + compose healthcheck

**Files:**
- Modify: `docker-compose.yml`（或项目根的 compose 文件）

- [ ] **Step 1: 定位 docker-compose 文件**

```bash
ls docker-compose*.yml
```

- [ ] **Step 2: 为 api 服务添加 keys volume 和 healthcheck**

在 `api` 服务下添加（参照已有 volumes 格式）：

```yaml
    environment:
      DataProtection__KeysPath: /data/keys   # 新增
    volumes:
      - wiki_data:/data/wiki
      - dp_keys:/data/keys                   # 新增
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:5200/api/health/ingest-worker"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
```

在 `volumes:` 区块末尾添加：

```yaml
  dp_keys:
```

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml   # 或实际文件名
git commit -m "feat: persist DataProtection key ring + Docker healthcheck for ingest worker"
```

---

## Task 12: 前端 — 移除浏览器端 ingest 执行路径

**Files:**
- Modify: `src/lib/ingest-queue.ts`

此任务只删除执行逻辑，保留类型定义和 UI 所需的 store 接口。

- [ ] **Step 1: 将 ingest-queue.ts 中 processNext 函数体置空，autoIngest 调用替换为 API 调用**

在 `ingest-queue.ts` 中，找到 `async function processNext(projectId: string)` 的实现，将整个函数体替换为：

```typescript
// 执行已迁移到后端 IngestWorkerService
// 此函数保留签名以避免调用处大规模修改，实际为空操作
async function processNext(_projectId: string): Promise<void> {}
```

找到所有 `autoIngest(...)` 的直接调用（在 `processNext` 内），一并删除。

- [ ] **Step 2: 删除 onQueueDrained 中的 sweepResolvedReviews 调用**

`sweepResolvedReviews` 将由后端在任务完成后触发（Phase 2），前端侧删除此调用：

```typescript
async function onQueueDrained(_projectId: string, _projectPath: string): Promise<void> {
  // Moved to backend — no-op
}
```

- [ ] **Step 3: 验证前端编译**

```bash
npm run typecheck
```

预期：无类型错误。

- [ ] **Step 4: 运行前端测试**

```bash
npm run test:mocks
```

预期：已有测试全部通过。

- [ ] **Step 5: Commit**

```bash
git add src/lib/ingest-queue.ts
git commit -m "feat: remove browser-side ingest execution (moved to backend worker)"
```

---

## Task 13: 前端 — SSE client

**Files:**
- Create: `src/api/sse-client.ts`
- Modify: `src/stores/tasks-store.ts`

- [ ] **Step 1: 创建 sse-client.ts**

```typescript
// src/api/sse-client.ts
import { httpPost } from "@/api/dotnet-client"

interface SseTokenResponse {
  token: string
  expiresAt: string
}

interface IngestSseEvent {
  taskId: string
  step: string
  detail: string
  timestamp?: string
  isSnapshot?: boolean
}

type IngestEventHandler = (event: IngestSseEvent) => void

export class IngestSseClient {
  private es: EventSource | null = null
  private token: string | null = null
  private lastEventId = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly deptId: string,
    private readonly baseUrl: string,
    private readonly onEvent: IngestEventHandler,
    private readonly onError?: (err: Event) => void,
  ) {}

  async connect(): Promise<void> {
    await this._fetchToken()
    this._openEventSource()
  }

  disconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.es) { this.es.close(); this.es = null }
  }

  private async _fetchToken(): Promise<void> {
    const res = await httpPost<SseTokenResponse>(
      `/api/departments/${this.deptId}/events/token`,
      {},
    )
    this.token = res.token
  }

  private _openEventSource(): void {
    if (!this.token) return
    const url = `${this.baseUrl}/api/departments/${this.deptId}/events?token=${this.token}&lastEventId=${this.lastEventId}`
    this.es = new EventSource(url)

    this.es.onmessage = (e) => {
      if (e.lastEventId) this.lastEventId = parseInt(e.lastEventId, 10)
      try {
        const data = JSON.parse(e.data) as IngestSseEvent
        this.onEvent(data)
      } catch { /* malformed event — ignore */ }
    }

    this.es.onerror = async (e) => {
      this.es?.close()
      this.es = null
      this.onError?.(e)
      // 重新换 token 再重连（token 可能已过期）
      this.reconnectTimer = setTimeout(async () => {
        try {
          await this._fetchToken()
          this._openEventSource()
        } catch { /* 无网络 — 稍后重试 */ }
      }, 3000)
    }
  }
}
```

- [ ] **Step 2: 在 tasks-store.ts 中连接 SSE**

找到 `tasks-store.ts`，添加 SSE 订阅逻辑。在 store 的 action 区域添加：

```typescript
import { IngestSseClient } from "@/api/sse-client"

// 在 store state 中添加
sseClient: null as IngestSseClient | null,

// 在 actions 中添加
startSseSubscription: (deptId: string, baseUrl: string) => {
  const { sseClient } = get()
  sseClient?.disconnect()

  const client = new IngestSseClient(deptId, baseUrl, (event) => {
    if (event.isSnapshot) return  // 快照由 REST API 初始加载，SSE 只处理增量
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === event.taskId
          ? { ...t, status: event.step as IngestTask["status"], progressDetail: event.detail }
          : t,
      ),
    }))
  })

  client.connect().catch(console.error)
  set({ sseClient: client })
},

stopSseSubscription: () => {
  get().sseClient?.disconnect()
  set({ sseClient: null })
},
```

- [ ] **Step 3: 编译验证**

```bash
npm run typecheck
```

预期：无类型错误。

- [ ] **Step 4: Commit**

```bash
git add src/api/sse-client.ts src/stores/tasks-store.ts
git commit -m "feat: frontend SSE client with token auth and auto-reconnect"
```

---

## Task 14: 前端 — 用户 LLM 配置页

**Files:**
- Create: `src/components/settings/UserLlmConfigSettings.tsx`

- [ ] **Step 1: 创建配置组件**

```tsx
// src/components/settings/UserLlmConfigSettings.tsx
import { useState, useEffect } from "react"
import { httpGet, httpPut } from "@/api/dotnet-client"
import { useTranslation } from "react-i18next"

interface LlmConfigResponse {
  id: string
  provider: string
  endpoint: string
  hasApiKey: boolean
  model: string
  apiMode?: string
  maxContextSize: number
  isActive: boolean
}

export function UserLlmConfigSettings() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<LlmConfigResponse | null>(null)
  const [form, setForm] = useState({
    provider: "openai",
    endpoint: "",
    apiKey: "",
    model: "",
    maxContextSize: 32000,
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    httpGet<LlmConfigResponse>("/api/llm-configs/me")
      .then((cfg) => {
        setConfig(cfg)
        setForm({
          provider: cfg.provider,
          endpoint: cfg.endpoint,
          apiKey: "",  // 不回显 key
          model: cfg.model,
          maxContextSize: cfg.maxContextSize,
        })
      })
      .catch(() => {})  // 404 = 未配置，显示空表单
  }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      const updated = await httpPut<LlmConfigResponse>("/api/llm-configs/me", form)
      setConfig(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium">个人 LLM 配置（优先于部门配置）</h3>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-xs">
          Provider
          <select
            value={form.provider}
            onChange={(e) => setForm({ ...form, provider: e.target.value })}
            className="border rounded px-2 py-1"
          >
            <option value="openai">OpenAI / 兼容</option>
            <option value="anthropic">Anthropic</option>
            <option value="ollama">Ollama</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Endpoint
          <input
            value={form.endpoint}
            onChange={(e) => setForm({ ...form, endpoint: e.target.value })}
            placeholder="https://api.openai.com"
            className="border rounded px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          API Key {config?.hasApiKey && <span className="text-green-600">（已配置）</span>}
          <input
            type="password"
            value={form.apiKey}
            onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
            placeholder={config?.hasApiKey ? "留空保留现有 key" : "sk-..."}
            className="border rounded px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Model
          <input
            value={form.model}
            onChange={(e) => setForm({ ...form, model: e.target.value })}
            placeholder="gpt-4o"
            className="border rounded px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Max Context Size
          <input
            type="number"
            value={form.maxContextSize}
            onChange={(e) => setForm({ ...form, maxContextSize: parseInt(e.target.value) || 32000 })}
            className="border rounded px-2 py-1"
          />
        </label>
      </div>
      <button
        onClick={handleSave}
        disabled={saving}
        className="px-4 py-1.5 bg-blue-600 text-white rounded text-sm disabled:opacity-50"
      >
        {saving ? "保存中..." : saved ? "已保存" : "保存"}
      </button>
    </div>
  )
}
```

- [ ] **Step 2: 将组件集成到设置页**

在设置页中找到 `src/components/settings/` 下的主设置组件，import 并渲染 `<UserLlmConfigSettings />`。

- [ ] **Step 3: 编译验证**

```bash
npm run typecheck
npm run build
```

预期：无错误。

- [ ] **Step 4: 运行前端测试**

```bash
npm run test:mocks
```

预期：已有测试全部通过。

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/UserLlmConfigSettings.tsx
git commit -m "feat: user LLM config settings page"
```

---

## 自查清单

运行以下命令确认所有内容集成正确：

```bash
# 后端全量测试
cd llm-wiki-server
dotnet test tests/LlmWiki.Api.Tests

# 前端全量测试
cd ..
npm run test:mocks
npm run typecheck
```

全部通过后，按设计文档验证：
- [ ] `POST /api/departments/{id}/ingest-tasks` 触发 worker 信号
- [ ] `GET /api/health/ingest-worker` 返回 `workerAlive: true`
- [ ] `POST /api/departments/{id}/events/token` 需要 JWT
- [ ] `GET /api/departments/{id}/events?token=...` 返回 `text/event-stream`
- [ ] DB 中的 `running` 任务在服务重启后被重置为 `queued`
