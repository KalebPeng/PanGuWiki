# AI Image Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Web-only department workspace image generation tool backed by an OpenAI Images API compatible relay and a per-account private image asset library.

**Architecture:** The React department app adds a left-sidebar route for `/d/:deptId/images`. The ASP.NET Core API owns relay credentials, calls the relay synchronously, stores generated image bytes under an independent `ImageAssets:RootPath`, and persists metadata in PostgreSQL with `department_id + user_id` access checks.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind CSS, ASP.NET Core 8, EF Core/Npgsql, xUnit, Vitest.

---

## File Structure

Backend files:

- Create `llm-wiki-server/src/LlmWiki.Api/Modules/Wiki/Entities/ImageGenerationConfig.cs`: department-level relay configuration entity.
- Create `llm-wiki-server/src/LlmWiki.Api/Modules/Wiki/Entities/GeneratedImage.cs`: per-user generated image metadata entity.
- Modify `llm-wiki-server/src/LlmWiki.Api/Infrastructure/AppDbContext.cs`: add DbSets, table mapping, indexes, active-config uniqueness.
- Create EF migration under `llm-wiki-server/src/LlmWiki.Api/Infrastructure/Migrations/`: add both tables.
- Create `llm-wiki-server/src/LlmWiki.Api/Infrastructure/ImageAssets/ImageAssetOptions.cs`: root path option.
- Create `llm-wiki-server/src/LlmWiki.Api/Infrastructure/ImageAssets/ImageAssetStorage.cs`: save/read/delete bytes under independent asset root.
- Create `llm-wiki-server/src/LlmWiki.Api/Infrastructure/ImageGeneration/OpenAiImagesClient.cs`: relay HTTP client and response parser.
- Create `llm-wiki-server/src/LlmWiki.Api/Modules/Wiki/ImageGenerationController.cs`: config, generate, list, content, delete endpoints.
- Modify `llm-wiki-server/src/LlmWiki.Api/Program.cs`: register options, storage, HTTP client.
- Modify `llm-wiki-server/src/LlmWiki.Api/appsettings.json` and `appsettings.Development.json`: add `ImageAssets:RootPath`.
- Modify `docker-compose.yml`: add image asset volume or bind mount to API service.

Frontend files:

- Create `src/api/image-generation.ts`: typed API wrapper for config, generate, list, content, delete.
- Create `src/pages/ImageGenerationPage.tsx`: standalone generation page and asset library.
- Modify `src/App.tsx`: add `/d/:deptId/images` route.
- Modify `src/pages/WikiDashboardPage.tsx`: add `AI 图片生成` left-sidebar item below `Wiki 知识库`.
- Modify `src/pages/DeptSettingsPage.tsx`: add `AI 图片生成` settings section.

Tests:

- Create `llm-wiki-server/tests/LlmWiki.Api.Tests/ImageGenerationControllerTests.cs`.
- Create `llm-wiki-server/tests/LlmWiki.Api.Tests/ImageAssetStorageTests.cs`.
- Create `src/api/image-generation.test.ts`.
- Create `src/pages/ImageGenerationPage.test.tsx` only if the current Vitest setup can render React components without adding new test infrastructure; otherwise cover API and route integration with focused unit tests.

---

### Task 1: Backend Entities And EF Mapping

**Files:**
- Create: `llm-wiki-server/src/LlmWiki.Api/Modules/Wiki/Entities/ImageGenerationConfig.cs`
- Create: `llm-wiki-server/src/LlmWiki.Api/Modules/Wiki/Entities/GeneratedImage.cs`
- Modify: `llm-wiki-server/src/LlmWiki.Api/Infrastructure/AppDbContext.cs`
- Test: `llm-wiki-server/tests/LlmWiki.Api.Tests/ImageGenerationControllerTests.cs`

- [ ] **Step 1: Write failing model mapping test**

Add this test to `ImageGenerationControllerTests.cs`:

```csharp
using LlmWiki.Api.Infrastructure;
using LlmWiki.Api.Modules.Wiki.Entities;
using Microsoft.EntityFrameworkCore;

namespace LlmWiki.Api.Tests;

public class ImageGenerationControllerTests
{
    [Fact]
    public async Task AppDbContext_PersistsImageGenerationConfigAndGeneratedImage()
    {
        await using var db = CreateDb(nameof(AppDbContext_PersistsImageGenerationConfigAndGeneratedImage));
        var deptId = Guid.NewGuid();
        var userId = Guid.NewGuid();

        db.ImageGenerationConfigs.Add(new ImageGenerationConfig
        {
            Id = Guid.NewGuid(),
            DepartmentId = deptId,
            BaseUrl = "https://relay.example.com",
            EncryptedApiKey = "encrypted",
            Model = "gpt-image-1",
            DefaultSize = "1024x1024",
            IsActive = true,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        });
        db.GeneratedImages.Add(new GeneratedImage
        {
            Id = Guid.NewGuid(),
            DepartmentId = deptId,
            UserId = userId,
            Prompt = "A quiet product photo",
            Model = "gpt-image-1",
            Size = "1024x1024",
            FilePath = "dept/users/user/2026/06/image.png",
            MimeType = "image/png",
            CreatedAt = DateTime.UtcNow,
        });

        await db.SaveChangesAsync();

        Assert.Equal(1, await db.ImageGenerationConfigs.CountAsync(c => c.DepartmentId == deptId));
        Assert.Equal(1, await db.GeneratedImages.CountAsync(i => i.DepartmentId == deptId && i.UserId == userId));
    }

    private static AppDbContext CreateDb(string name)
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(name)
            .Options;
        return new AppDbContext(options);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
dotnet test llm-wiki-server/tests/LlmWiki.Api.Tests/LlmWiki.Api.Tests.csproj --filter "ClassName=LlmWiki.Api.Tests.ImageGenerationControllerTests"
```

Expected: compile failure because `ImageGenerationConfig`, `GeneratedImage`, and the DbSets do not exist.

- [ ] **Step 3: Add entities**

Create `ImageGenerationConfig.cs`:

```csharp
namespace LlmWiki.Api.Modules.Wiki.Entities;

public class ImageGenerationConfig
{
    public Guid Id { get; set; }
    public Guid DepartmentId { get; set; }
    public string BaseUrl { get; set; } = "";
    public string EncryptedApiKey { get; set; } = "";
    public string Model { get; set; } = "";
    public string DefaultSize { get; set; } = "1024x1024";
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
```

Create `GeneratedImage.cs`:

```csharp
namespace LlmWiki.Api.Modules.Wiki.Entities;

public class GeneratedImage
{
    public Guid Id { get; set; }
    public Guid DepartmentId { get; set; }
    public Guid UserId { get; set; }
    public string Prompt { get; set; } = "";
    public string Model { get; set; } = "";
    public string Size { get; set; } = "";
    public string FilePath { get; set; } = "";
    public string MimeType { get; set; } = "image/png";
    public string? SourceUrl { get; set; }
    public DateTime CreatedAt { get; set; }
}
```

- [ ] **Step 4: Add AppDbContext mapping**

In `AppDbContext`, add:

```csharp
public DbSet<ImageGenerationConfig> ImageGenerationConfigs => Set<ImageGenerationConfig>();
public DbSet<GeneratedImage> GeneratedImages => Set<GeneratedImage>();
```

Inside `OnModelCreating`, add:

```csharp
modelBuilder.Entity<ImageGenerationConfig>(e =>
{
    e.ToTable("image_generation_configs");
    e.HasKey(c => c.Id);
    e.Property(c => c.Id).HasDefaultValueSql("gen_random_uuid()");
    e.Property(c => c.IsActive).HasDefaultValue(true);
    e.Property(c => c.DefaultSize).HasDefaultValue("1024x1024");
    e.Property(c => c.CreatedAt).HasDefaultValueSql("now()");
    e.Property(c => c.UpdatedAt).HasDefaultValueSql("now()");
    e.HasIndex(c => c.DepartmentId)
        .HasFilter("is_active = true")
        .IsUnique();
});

modelBuilder.Entity<GeneratedImage>(e =>
{
    e.ToTable("generated_images");
    e.HasKey(i => i.Id);
    e.Property(i => i.Id).HasDefaultValueSql("gen_random_uuid()");
    e.Property(i => i.CreatedAt).HasDefaultValueSql("now()");
    e.HasIndex(i => new { i.DepartmentId, i.UserId, i.CreatedAt });
    e.HasIndex(i => new { i.DepartmentId, i.Id });
});
```

- [ ] **Step 5: Run test to verify it passes**

Run the same `dotnet test` command.

Expected: PASS.

- [ ] **Step 6: Create EF migration**

Run from `llm-wiki-server/src/LlmWiki.Api`:

```bash
dotnet ef migrations add AddImageGenerationAssets
```

Expected: migration adds `image_generation_configs` and `generated_images`, and updates `AppDbContextModelSnapshot`.

- [ ] **Step 7: Commit**

```bash
git add llm-wiki-server/src/LlmWiki.Api/Modules/Wiki/Entities/ImageGenerationConfig.cs \
        llm-wiki-server/src/LlmWiki.Api/Modules/Wiki/Entities/GeneratedImage.cs \
        llm-wiki-server/src/LlmWiki.Api/Infrastructure/AppDbContext.cs \
        llm-wiki-server/src/LlmWiki.Api/Infrastructure/Migrations \
        llm-wiki-server/tests/LlmWiki.Api.Tests/ImageGenerationControllerTests.cs
git commit -m "feat: add image generation persistence"
```

### Task 2: Independent Image Asset Storage

**Files:**
- Create: `llm-wiki-server/src/LlmWiki.Api/Infrastructure/ImageAssets/ImageAssetOptions.cs`
- Create: `llm-wiki-server/src/LlmWiki.Api/Infrastructure/ImageAssets/ImageAssetStorage.cs`
- Modify: `llm-wiki-server/src/LlmWiki.Api/Program.cs`
- Modify: `llm-wiki-server/src/LlmWiki.Api/appsettings.json`
- Modify: `llm-wiki-server/src/LlmWiki.Api/appsettings.Development.json`
- Test: `llm-wiki-server/tests/LlmWiki.Api.Tests/ImageAssetStorageTests.cs`

- [ ] **Step 1: Write failing storage test**

```csharp
using LlmWiki.Api.Infrastructure.ImageAssets;
using Microsoft.Extensions.Options;

namespace LlmWiki.Api.Tests;

public class ImageAssetStorageTests
{
    [Fact]
    public async Task SaveAsync_WritesUnderConfiguredRootAndReadAsyncReturnsBytes()
    {
        var root = Path.Combine(Path.GetTempPath(), "llmwiki-image-assets", Guid.NewGuid().ToString("N"));
        var storage = new ImageAssetStorage(Options.Create(new ImageAssetOptions { RootPath = root }));
        var deptId = Guid.NewGuid();
        var userId = Guid.NewGuid();
        var imageId = Guid.NewGuid();
        var bytes = new byte[] { 137, 80, 78, 71 };

        var relativePath = await storage.SaveAsync(deptId, userId, imageId, "image/png", bytes, CancellationToken.None);
        var saved = await storage.ReadAsync(relativePath, CancellationToken.None);

        Assert.Equal(bytes, saved.Bytes);
        Assert.Equal("image/png", saved.MimeType);
        Assert.StartsWith(root, Path.GetFullPath(Path.Combine(root, relativePath)));
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
dotnet test llm-wiki-server/tests/LlmWiki.Api.Tests/LlmWiki.Api.Tests.csproj --filter "ClassName=LlmWiki.Api.Tests.ImageAssetStorageTests"
```

Expected: compile failure because storage classes do not exist.

- [ ] **Step 3: Add options and storage**

`ImageAssetOptions.cs`:

```csharp
namespace LlmWiki.Api.Infrastructure.ImageAssets;

public class ImageAssetOptions
{
    public string RootPath { get; set; } = "./data/image-assets";
}
```

`ImageAssetStorage.cs`:

```csharp
using Microsoft.Extensions.Options;

namespace LlmWiki.Api.Infrastructure.ImageAssets;

public class ImageAssetStorage(IOptions<ImageAssetOptions> options)
{
    private readonly string _root = Path.GetFullPath(options.Value.RootPath);

    public async Task<string> SaveAsync(
        Guid departmentId,
        Guid userId,
        Guid imageId,
        string mimeType,
        byte[] bytes,
        CancellationToken ct)
    {
        var extension = mimeType.Equals("image/jpeg", StringComparison.OrdinalIgnoreCase) ? ".jpg" : ".png";
        var now = DateTime.UtcNow;
        var relativePath = Path.Combine(
            departmentId.ToString(),
            "users",
            userId.ToString(),
            now.Year.ToString("0000"),
            now.Month.ToString("00"),
            imageId + extension);
        var fullPath = Resolve(relativePath, allowMissing: true);
        Directory.CreateDirectory(Path.GetDirectoryName(fullPath)!);
        await File.WriteAllBytesAsync(fullPath, bytes, ct);
        return relativePath.Replace('\\', '/');
    }

    public async Task<(byte[] Bytes, string MimeType)> ReadAsync(string relativePath, CancellationToken ct)
    {
        var fullPath = Resolve(relativePath, allowMissing: false);
        var ext = Path.GetExtension(fullPath).ToLowerInvariant();
        var mimeType = ext == ".jpg" || ext == ".jpeg" ? "image/jpeg" : "image/png";
        return (await File.ReadAllBytesAsync(fullPath, ct), mimeType);
    }

    public Task DeleteAsync(string relativePath)
    {
        var fullPath = Resolve(relativePath, allowMissing: true);
        if (File.Exists(fullPath)) File.Delete(fullPath);
        return Task.CompletedTask;
    }

    private string Resolve(string relativePath, bool allowMissing)
    {
        var fullPath = Path.GetFullPath(Path.Combine(_root, relativePath.TrimStart('/', '\\')));
        var rootWithSep = _root.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
            + Path.DirectorySeparatorChar;
        if (!fullPath.StartsWith(rootWithSep, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Invalid image asset path.");
        if (!allowMissing && !File.Exists(fullPath))
            throw new FileNotFoundException("Image asset not found.", fullPath);
        return fullPath;
    }
}
```

- [ ] **Step 4: Register storage and config**

In `Program.cs`:

```csharp
builder.Services.Configure<ImageAssetOptions>(builder.Configuration.GetSection("ImageAssets"));
builder.Services.AddSingleton<ImageAssetStorage>();
```

Add using:

```csharp
using LlmWiki.Api.Infrastructure.ImageAssets;
```

In `appsettings.json`:

```json
"ImageAssets": {
  "RootPath": "/data/image-assets"
}
```

In `appsettings.Development.json`:

```json
"ImageAssets": {
  "RootPath": "./data/image-assets"
}
```

- [ ] **Step 5: Run storage test**

Run the same `dotnet test` command.

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add llm-wiki-server/src/LlmWiki.Api/Infrastructure/ImageAssets \
        llm-wiki-server/src/LlmWiki.Api/Program.cs \
        llm-wiki-server/src/LlmWiki.Api/appsettings.json \
        llm-wiki-server/src/LlmWiki.Api/appsettings.Development.json \
        llm-wiki-server/tests/LlmWiki.Api.Tests/ImageAssetStorageTests.cs
git commit -m "feat: add independent image asset storage"
```

### Task 3: Relay Client And Generate Endpoint

**Files:**
- Create: `llm-wiki-server/src/LlmWiki.Api/Infrastructure/ImageGeneration/OpenAiImagesClient.cs`
- Create: `llm-wiki-server/src/LlmWiki.Api/Modules/Wiki/ImageGenerationController.cs`
- Modify: `llm-wiki-server/src/LlmWiki.Api/Program.cs`
- Test: `llm-wiki-server/tests/LlmWiki.Api.Tests/ImageGenerationControllerTests.cs`

- [ ] **Step 1: Add failing tests for secret-safe config and missing config**

Append:

```csharp
[Fact]
public async Task GetConfig_DoesNotReturnApiKey()
{
    await using var factory = new TestWebApplicationFactory();
    var client = factory.CreateAuthenticatedClient();
    var deptId = await factory.CreateDepartmentWithMemberAsync(client, role: "admin");

    await client.PutAsJsonAsync($"/api/departments/{deptId}/image-generation/config", new
    {
        enabled = true,
        base_url = "https://relay.example.com",
        api_key = "secret-key",
        model = "gpt-image-1",
        default_size = "1024x1024",
    });

    var response = await client.GetFromJsonAsync<ImageGenerationConfigResponse>(
        $"/api/departments/{deptId}/image-generation/config");

    Assert.NotNull(response);
    Assert.True(response!.HasApiKey);
    Assert.DoesNotContain("secret", System.Text.Json.JsonSerializer.Serialize(response));
}

[Fact]
public async Task Generate_ReturnsBadRequestWhenConfigMissing()
{
    await using var factory = new TestWebApplicationFactory();
    var client = factory.CreateAuthenticatedClient();
    var deptId = await factory.CreateDepartmentWithMemberAsync(client, role: "editor");

    var response = await client.PostAsJsonAsync($"/api/departments/{deptId}/images/generate", new
    {
        prompt = "A clean product render",
        n = 1,
    });

    Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
}
```

If `TestWebApplicationFactory` lacks `CreateAuthenticatedClient` or `CreateDepartmentWithMemberAsync`, add focused helpers there that create a user, issue a JWT, create an org/department/member, and set the bearer token.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
dotnet test llm-wiki-server/tests/LlmWiki.Api.Tests/LlmWiki.Api.Tests.csproj --filter "ClassName=LlmWiki.Api.Tests.ImageGenerationControllerTests"
```

Expected: compile or 404 failure because endpoints do not exist.

- [ ] **Step 3: Add relay client**

Create `OpenAiImagesClient.cs`:

```csharp
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace LlmWiki.Api.Infrastructure.ImageGeneration;

public record GeneratedImagePayload(byte[] Bytes, string MimeType, string? SourceUrl);

public class OpenAiImagesClient(HttpClient http)
{
    public async Task<IReadOnlyList<GeneratedImagePayload>> GenerateAsync(
        string baseUrl,
        string apiKey,
        string model,
        string prompt,
        string size,
        int n,
        CancellationToken ct)
    {
        var endpoint = baseUrl.TrimEnd('/') + "/v1/images/generations";
        using var req = new HttpRequestMessage(HttpMethod.Post, endpoint);
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
        req.Content = new StringContent(JsonSerializer.Serialize(new
        {
            model,
            prompt,
            size,
            n,
        }), Encoding.UTF8, "application/json");

        using var res = await http.SendAsync(req, ct);
        var text = await res.Content.ReadAsStringAsync(ct);
        if (!res.IsSuccessStatusCode)
            throw new InvalidOperationException($"Image relay returned {(int)res.StatusCode}.");

        using var doc = JsonDocument.Parse(text);
        var data = doc.RootElement.GetProperty("data");
        var results = new List<GeneratedImagePayload>();
        foreach (var item in data.EnumerateArray())
        {
            if (item.TryGetProperty("b64_json", out var b64Prop))
            {
                results.Add(new GeneratedImagePayload(Convert.FromBase64String(b64Prop.GetString() ?? ""), "image/png", null));
                continue;
            }
            if (item.TryGetProperty("url", out var urlProp))
            {
                var url = urlProp.GetString() ?? throw new InvalidOperationException("Image URL is empty.");
                var bytes = await http.GetByteArrayAsync(url, ct);
                results.Add(new GeneratedImagePayload(bytes, "image/png", url));
                continue;
            }
            throw new InvalidOperationException("Image relay response did not contain url or b64_json.");
        }
        return results;
    }
}
```

- [ ] **Step 4: Register relay client**

In `Program.cs`:

```csharp
builder.Services.AddHttpClient<OpenAiImagesClient>(c =>
    c.Timeout = TimeSpan.FromMinutes(5));
```

Add using:

```csharp
using LlmWiki.Api.Infrastructure.ImageGeneration;
```

- [ ] **Step 5: Add controller skeleton with config endpoints and missing-config generate**

Create `ImageGenerationController.cs` with records:

```csharp
public record UpsertImageGenerationConfigRequest(
    bool Enabled,
    string BaseUrl,
    string? ApiKey,
    string Model,
    string DefaultSize);

public record ImageGenerationConfigResponse(
    Guid Id,
    bool Enabled,
    string BaseUrl,
    bool HasApiKey,
    string Model,
    string DefaultSize);

public record GenerateImagesRequest(string Prompt, string? Model, string? Size, int? N);
```

Controller behavior:

- `GET config`: `[RequireDeptRole]`, return 404 if missing, no API key.
- `PUT config`: `[RequireDeptRole("admin")]`, preserve encrypted key when `ApiKey` is null or empty.
- `POST generate`: `[RequireDeptRole]`, return `BadRequest(new { error = "Image generation is not configured." })` when no active config or no encrypted key.

- [ ] **Step 6: Run tests to verify current cases pass**

Run the same backend test command.

Expected: PASS for config and missing-config tests.

- [ ] **Step 7: Add failing test for b64 generation saving metadata**

Add a test using a fake `HttpMessageHandler` or test server so the relay returns:

```json
{"data":[{"b64_json":"iVBORw0KGgo="}]}
```

Assert:

```csharp
var list = await client.GetFromJsonAsync<GeneratedImageListResponse>(
    $"/api/departments/{deptId}/images");
Assert.Single(list!.Images);
Assert.Equal("A clean product render", list.Images[0].Prompt);
```

- [ ] **Step 8: Implement generate/list/content/delete**

Controller generate flow:

1. Validate `Prompt` is non-empty.
2. Clamp `n` to `1-4`.
3. Load active department config.
4. Decrypt API key with `LlmConfigService.DecryptIfNotEmpty`.
5. Call `OpenAiImagesClient.GenerateAsync`.
6. For each payload, create `GeneratedImage.Id`, save bytes with `ImageAssetStorage.SaveAsync`, add metadata row.
7. Return generated image DTOs.

List/content/delete flow:

- List filters `DepartmentId == deptId && UserId == currentUser.UserId`.
- Content filters the same and returns `File(bytes, mimeType)`.
- Delete filters the same, deletes file, removes row.

- [ ] **Step 9: Run backend tests**

Run:

```bash
dotnet test llm-wiki-server/tests/LlmWiki.Api.Tests/LlmWiki.Api.Tests.csproj --filter "ImageGeneration"
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add llm-wiki-server/src/LlmWiki.Api/Infrastructure/ImageGeneration \
        llm-wiki-server/src/LlmWiki.Api/Modules/Wiki/ImageGenerationController.cs \
        llm-wiki-server/src/LlmWiki.Api/Program.cs \
        llm-wiki-server/tests/LlmWiki.Api.Tests/ImageGenerationControllerTests.cs
git commit -m "feat: add image generation API"
```

### Task 4: Frontend API Client

**Files:**
- Create: `src/api/image-generation.ts`
- Create: `src/api/image-generation.test.ts`

- [ ] **Step 1: Write failing API wrapper tests**

```typescript
import { describe, expect, test, vi } from "vitest"
import { generateImages, getImageGenerationConfig, listGeneratedImages } from "./image-generation"

vi.mock("@/api/dotnet-client", () => ({
  httpGet: vi.fn(),
  httpPost: vi.fn(),
  httpPut: vi.fn(),
  httpDelete: vi.fn(),
}))

describe("image-generation api", async () => {
  const client = await import("@/api/dotnet-client")

  test("gets config for department", async () => {
    vi.mocked(client.httpGet).mockResolvedValueOnce({ enabled: true })
    await getImageGenerationConfig("dept-1")
    expect(client.httpGet).toHaveBeenCalledWith("/api/departments/dept-1/image-generation/config")
  })

  test("posts generate request", async () => {
    vi.mocked(client.httpPost).mockResolvedValueOnce({ images: [] })
    await generateImages("dept-1", { prompt: "cat", model: "gpt-image-1", size: "1024x1024", n: 1 })
    expect(client.httpPost).toHaveBeenCalledWith("/api/departments/dept-1/images/generate", {
      prompt: "cat",
      model: "gpt-image-1",
      size: "1024x1024",
      n: 1,
    })
  })

  test("lists personal images", async () => {
    vi.mocked(client.httpGet).mockResolvedValueOnce({ images: [] })
    await listGeneratedImages("dept-1")
    expect(client.httpGet).toHaveBeenCalledWith("/api/departments/dept-1/images")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run src/api/image-generation.test.ts
```

Expected: module not found.

- [ ] **Step 3: Implement API wrapper**

```typescript
import { httpDelete, httpGet, httpPost, httpPut } from "@/api/dotnet-client"

export interface ImageGenerationConfig {
  id: string
  enabled: boolean
  base_url: string
  has_api_key: boolean
  model: string
  default_size: string
}

export interface GeneratedImage {
  id: string
  prompt: string
  model: string
  size: string
  content_url: string
  created_at: string
}

export interface GenerateImagesRequest {
  prompt: string
  model?: string
  size?: string
  n?: number
}

export async function getImageGenerationConfig(deptId: string) {
  return httpGet<ImageGenerationConfig>(`/api/departments/${deptId}/image-generation/config`)
}

export async function upsertImageGenerationConfig(
  deptId: string,
  body: { enabled: boolean; base_url: string; api_key?: string; model: string; default_size: string },
) {
  return httpPut<ImageGenerationConfig>(`/api/departments/${deptId}/image-generation/config`, body)
}

export async function generateImages(deptId: string, body: GenerateImagesRequest) {
  return httpPost<{ images: GeneratedImage[] }>(`/api/departments/${deptId}/images/generate`, body)
}

export async function listGeneratedImages(deptId: string) {
  return httpGet<{ images: GeneratedImage[] }>(`/api/departments/${deptId}/images`)
}

export function generatedImageContentUrl(deptId: string, imageId: string) {
  return `/api/departments/${deptId}/images/${imageId}/content`
}

export async function deleteGeneratedImage(deptId: string, imageId: string) {
  return httpDelete<void>(`/api/departments/${deptId}/images/${imageId}`)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run the same Vitest command.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api/image-generation.ts src/api/image-generation.test.ts
git commit -m "feat: add image generation frontend api"
```

### Task 5: Workspace Navigation And Route

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/pages/WikiDashboardPage.tsx`
- Create: `src/pages/ImageGenerationPage.tsx`

- [ ] **Step 1: Add placeholder page**

Create `ImageGenerationPage.tsx`:

```tsx
interface ImageGenerationPageProps {
  deptId: string
  onBackHome: () => void
  onOpenSettings: () => void
}

export function ImageGenerationPage({ deptId }: ImageGenerationPageProps) {
  return (
    <main className="min-h-screen bg-background px-10 py-10 text-foreground">
      <div className="mx-auto max-w-6xl">
        <p className="text-sm text-muted-foreground">{deptId}</p>
        <h1 className="text-3xl font-semibold tracking-normal">AI 图片生成</h1>
      </div>
    </main>
  )
}
```

- [ ] **Step 2: Modify route**

In `DeptApp` routes in `src/App.tsx`, add before the wildcard route:

```tsx
<Route path="images" element={
  <ImageGenerationPage
    deptId={deptId!}
    onBackHome={() => navigate(`/d/${deptId}`)}
    onOpenSettings={() => navigate(`/d/${deptId}/settings`)}
  />
} />
```

Import:

```tsx
import { ImageGenerationPage } from "@/pages/ImageGenerationPage"
```

- [ ] **Step 3: Modify dashboard sidebar**

In `WikiDashboardPage.tsx`, extend `DashboardView`:

```tsx
type DashboardView = "home" | "images" | "settings" | "admin"
```

Add the sidebar item directly after `Wiki 知识库`:

```tsx
<button
  onClick={() => navigate(`/d/${deptId}/images`)}
  className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
>
  <ImageIcon className="h-4 w-4" />
  <span>AI 图片生成</span>
</button>
```

Use `ImageIcon` from `lucide-react`.

- [ ] **Step 4: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/pages/WikiDashboardPage.tsx src/pages/ImageGenerationPage.tsx
git commit -m "feat: add image generation workspace route"
```

### Task 6: Image Generation Page UI

**Files:**
- Modify: `src/pages/ImageGenerationPage.tsx`

- [ ] **Step 1: Implement page state around API client**

Use `getImageGenerationConfig`, `generateImages`, `listGeneratedImages`, `deleteGeneratedImage`, and `generatedImageContentUrl`.

State:

```tsx
const [config, setConfig] = useState<ImageGenerationConfig | null>(null)
const [images, setImages] = useState<GeneratedImage[]>([])
const [prompt, setPrompt] = useState("")
const [model, setModel] = useState("")
const [size, setSize] = useState("1024x1024")
const [count, setCount] = useState(1)
const [loading, setLoading] = useState(true)
const [generating, setGenerating] = useState(false)
const [error, setError] = useState<string | null>(null)
const [preview, setPreview] = useState<GeneratedImage | null>(null)
```

Load config and images in `useEffect`; 404 config should set `config` to null without breaking image list.

- [ ] **Step 2: Implement unconfigured state**

Render:

```tsx
<div className="rounded-xl border border-dashed border-border bg-card px-6 py-8">
  <h2 className="text-base font-semibold">尚未配置 AI 图片生成</h2>
  <p className="mt-2 text-sm text-muted-foreground">请先在工作区设置中配置 OpenAI Images API 兼容中转站。</p>
  <button onClick={onOpenSettings} className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
    前往工作区设置
  </button>
</div>
```

- [ ] **Step 3: Implement generation form**

Use a dense workbench layout, not a marketing page. The form should have stable controls, restrained borders, and no nested cards.

Generate handler:

```tsx
async function handleGenerate(e: React.FormEvent) {
  e.preventDefault()
  if (!prompt.trim()) return
  setGenerating(true)
  setError(null)
  try {
    const result = await generateImages(deptId, {
      prompt: prompt.trim(),
      model: model.trim() || undefined,
      size,
      n: count,
    })
    setImages((prev) => [...result.images, ...prev])
  } catch (err) {
    setError(err instanceof Error ? err.message : "生成失败，请重试")
  } finally {
    setGenerating(false)
  }
}
```

- [ ] **Step 4: Implement personal asset grid**

For each image:

```tsx
<button onClick={() => setPreview(image)} className="group overflow-hidden rounded-lg border border-border bg-card text-left">
  <img src={generatedImageContentUrl(deptId, image.id)} alt={image.prompt} className="aspect-square w-full object-cover" />
  <div className="space-y-1 p-3">
    <p className="line-clamp-2 text-sm text-foreground">{image.prompt}</p>
    <p className="text-xs text-muted-foreground">{image.model} · {image.size}</p>
  </div>
</button>
```

- [ ] **Step 5: Implement preview dialog**

Use existing modal/dialog component if present under `src/components/ui`; otherwise render a fixed overlay with close, download link, and delete button. Delete calls `deleteGeneratedImage`, removes the card, and closes preview.

- [ ] **Step 6: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/pages/ImageGenerationPage.tsx
git commit -m "feat: build image generation page"
```

### Task 7: Workspace Settings Section

**Files:**
- Modify: `src/pages/DeptSettingsPage.tsx`

- [ ] **Step 1: Add image generation settings tab/section**

Follow the existing `MembersTab`, `RolesTab`, and `ModulesTab` pattern. Create a local component `ImageGenerationSettingsTab`.

State:

```tsx
const [form, setForm] = useState({
  enabled: true,
  baseUrl: "",
  apiKey: "",
  model: "gpt-image-1",
  defaultSize: "1024x1024",
})
const [hasApiKey, setHasApiKey] = useState(false)
const [saving, setSaving] = useState(false)
const [saved, setSaved] = useState(false)
const [error, setError] = useState<string | null>(null)
```

- [ ] **Step 2: Load config**

Call `getImageGenerationConfig(deptId)`. On 404, keep defaults and `hasApiKey = false`.

- [ ] **Step 3: Save config**

Call:

```tsx
await upsertImageGenerationConfig(deptId, {
  enabled: form.enabled,
  base_url: form.baseUrl,
  api_key: form.apiKey,
  model: form.model,
  default_size: form.defaultSize,
})
```

After save, clear `apiKey`, set `hasApiKey` from response.

- [ ] **Step 4: Wire into settings navigation**

Add the section label `AI 图片生成` in the settings page's tab list. Keep it near existing model/config sections, not member management.

- [ ] **Step 5: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/pages/DeptSettingsPage.tsx
git commit -m "feat: add image generation workspace settings"
```

### Task 8: Deployment Configuration

**Files:**
- Modify: `docker-compose.yml`
- Modify: `.env.deploy.example`
- Modify: `DEPLOY.md`

- [ ] **Step 1: Add Docker asset mount**

In API service environment:

```yaml
ImageAssets__RootPath: "/data/image-assets"
```

In API volumes:

```yaml
- image_assets:/data/image-assets
```

In top-level volumes:

```yaml
image_assets:
```

- [ ] **Step 2: Add deploy docs**

Document that generated image assets are independent from Wiki files and can be backed up separately.

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml .env.deploy.example DEPLOY.md
git commit -m "chore: configure image asset storage"
```

### Task 9: Final Verification

**Files:** no direct edits unless verification exposes a defect.

- [ ] **Step 1: Run frontend tests**

```bash
npm run test:mocks
```

Expected: PASS.

- [ ] **Step 2: Run frontend typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run backend tests**

```bash
dotnet test llm-wiki-server/LlmWiki.sln
```

Expected: PASS.

- [ ] **Step 4: Run MCP server tests if package files changed**

```bash
cd mcp-server
npm run test
```

Expected: PASS or skip if no MCP files changed in implementation.

- [ ] **Step 5: Review git diff**

```bash
git status --short
git log --oneline --decorate -8
```

Expected: clean working tree with task commits on `codex/ai-image-generation-workspace`.

