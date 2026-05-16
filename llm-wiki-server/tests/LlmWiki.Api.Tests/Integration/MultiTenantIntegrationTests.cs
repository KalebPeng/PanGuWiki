using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using LlmWiki.Api.Infrastructure;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.DependencyInjection;

namespace LlmWiki.Api.Tests.Integration;

// ---------------------------------------------------------------------------
// Custom WebApplicationFactory
// ---------------------------------------------------------------------------

/// <summary>
/// Factory that replaces PostgreSQL with an in-memory SQLite database and
/// injects a deterministic JWT secret so tests can run without external
/// infrastructure.
/// </summary>
/// <remarks>
/// A single <see cref="SqliteConnection"/> is held open for the lifetime of
/// the factory so that all DbContext instances created during a test share the
/// same in-memory database.  SQLite drops an ":memory:" database the moment
/// the last connection that opened it is closed.
/// </remarks>
public sealed class MultiTenantWebFactory : WebApplicationFactory<Program>, IAsyncDisposable
{
    private readonly SqliteConnection _keepAlive;

    public MultiTenantWebFactory()
    {
        _keepAlive = new SqliteConnection("DataSource=:memory:");
        _keepAlive.Open();
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        // ── JWT / env settings ────────────────────────────────────────────
        builder.UseSetting("Jwt:Secret", "test-secret-minimum-32-characters!!");
        builder.UseSetting("Jwt:Issuer", "llmwiki");
        builder.UseSetting("Jwt:Audience", "llmwiki");
        builder.UseSetting("WikiProjects:RootPath", Path.GetTempPath());
        builder.UseSetting("DataProtection:KeysPath", Path.Combine(Path.GetTempPath(), "llmwiki-test-keys"));
        builder.UseEnvironment("Testing"); // skips production Jwt secret guard; uses EnsureCreated instead of Migrate

        // ── Replace PostgreSQL DbContext with SQLite in-memory ────────────
        builder.ConfigureServices(services =>
        {
            // Remove the PostgreSQL DbContext options registered in Program.cs
            var toRemove = services
                .Where(d => d.ServiceType == typeof(DbContextOptions<AppDbContext>))
                .ToList();
            foreach (var d in toRemove)
                services.Remove(d);

            // Re-register AppDbContext with SQLite + our custom model customizer
            services.AddDbContext<AppDbContext>(options =>
            {
                options.UseSqlite(_keepAlive);
                options.UseSnakeCaseNamingConvention();
                // Replace the default IModelCustomizer with our SQLite-compatible one
                options.ReplaceService<IModelCustomizer, TestSqliteModelCustomizer>();
            });
        });
    }

    /// <summary>
    /// Creates the schema via EF Core's EnsureCreated on the shared connection.
    /// Must be called once per factory instance before the first HTTP request.
    /// </summary>
    public async Task InitializeDbAsync()
    {
        await using var scope = Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Database.EnsureCreatedAsync();
    }

    public new async ValueTask DisposeAsync()
    {
        await base.DisposeAsync();
        await _keepAlive.DisposeAsync();
    }
}

// ---------------------------------------------------------------------------
// Test class
// ---------------------------------------------------------------------------

/// <summary>
/// End-to-end integration tests covering the full multi-tenant flow:
/// Register → Login → Create Org → Create Department → Wiki query.
/// Each test method uses IAsyncLifetime to ensure the database schema is
/// created before the test runs.
/// </summary>
public class MultiTenantIntegrationTests : IAsyncLifetime
{
    private readonly MultiTenantWebFactory _factory;
    private readonly HttpClient _client;

    public MultiTenantIntegrationTests()
    {
        _factory = new MultiTenantWebFactory();
        _client = _factory.CreateClient();
    }

    public async Task InitializeAsync()
    {
        await _factory.InitializeDbAsync();
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
    }

    // ── Helper ────────────────────────────────────────────────────────────────

    private static StringContent Json(object payload) =>
        new(JsonSerializer.Serialize(payload,
                new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower }),
            System.Text.Encoding.UTF8,
            "application/json");

    // ── Tests ─────────────────────────────────────────────────────────────────

    /// <summary>
    /// Happy-path: register → login → /me → create org → create dept →
    /// list wiki pages → overview.
    /// </summary>
    [Fact]
    public async Task Register_Login_CreateOrg_CreateDept_ListWikiPages_FullFlow()
    {
        // 1. Register — expect 201 Created with access_token + refresh_token
        var registerResp = await _client.PostAsync("/api/auth/register", Json(new
        {
            email = "e2e_full@example.com",
            password = "Password123!",
            display_name = "E2E User"
        }));
        Assert.Equal(HttpStatusCode.Created, registerResp.StatusCode);

        var registerBody = await registerResp.Content.ReadFromJsonAsync<JsonElement>();
        var token = registerBody.GetProperty("access_token").GetString();
        Assert.False(string.IsNullOrEmpty(token), "access_token must be present after register");

        // 2. Login — expect 200 OK with tokens
        var loginResp = await _client.PostAsync("/api/auth/login", Json(new
        {
            email = "e2e_full@example.com",
            password = "Password123!"
        }));
        Assert.Equal(HttpStatusCode.OK, loginResp.StatusCode);

        var loginBody = await loginResp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(loginBody.TryGetProperty("access_token", out _), "login must return access_token");

        // 3. Authenticate subsequent requests with the register token
        _client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

        // 4. GET /api/auth/me — should return current user
        var meResp = await _client.GetAsync("/api/auth/me");
        Assert.Equal(HttpStatusCode.OK, meResp.StatusCode);

        var meBody = await meResp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("e2e_full@example.com", meBody.GetProperty("email").GetString());

        // 5. Create organization
        var orgResp = await _client.PostAsync("/api/orgs", Json(new
        {
            name = "E2E Test Org",
            slug = "e2e-test-org"
        }));
        Assert.Equal(HttpStatusCode.Created, orgResp.StatusCode);

        var orgBody = await orgResp.Content.ReadFromJsonAsync<JsonElement>();
        var orgId = orgBody.GetProperty("id").GetString();
        Assert.False(string.IsNullOrEmpty(orgId), "org id must be present");

        // 6. Create department — use a temp directory for the wiki path
        var wikiPath = Path.Combine(Path.GetTempPath(), "e2e_wiki_" + Guid.NewGuid().ToString("N"));

        var deptResp = await _client.PostAsync($"/api/orgs/{orgId}/departments", Json(new
        {
            name = "E2E Dept",
            slug = "e2e-dept",
            wiki_project_path = wikiPath
        }));
        Assert.Equal(HttpStatusCode.Created, deptResp.StatusCode);

        var deptBody = await deptResp.Content.ReadFromJsonAsync<JsonElement>();
        var deptId = deptBody.GetProperty("id").GetString();
        Assert.False(string.IsNullOrEmpty(deptId), "dept id must be present");

        try
        {
            // 7. List wiki pages — empty directory → empty pages list
            var pagesResp = await _client.GetAsync($"/api/departments/{deptId}/wiki/pages");
            Assert.Equal(HttpStatusCode.OK, pagesResp.StatusCode);

            var pagesBody = await pagesResp.Content.ReadFromJsonAsync<JsonElement>();
            Assert.True(pagesBody.TryGetProperty("pages", out var pagesArray),
                "response should contain a 'pages' property");
            Assert.Equal(JsonValueKind.Array, pagesArray.ValueKind);

            // 8. Wiki overview — empty dir returns 200 with empty content or 404
            var overviewResp = await _client.GetAsync($"/api/departments/{deptId}/wiki/overview");
            Assert.True(
                overviewResp.StatusCode == HttpStatusCode.OK ||
                overviewResp.StatusCode == HttpStatusCode.NotFound,
                $"Expected 200 or 404, got {overviewResp.StatusCode}");
        }
        finally
        {
            // Clean up temp wiki directory created by ProjectService
            if (Directory.Exists(wikiPath))
                Directory.Delete(wikiPath, recursive: true);
        }
    }

    /// <summary>
    /// Registering a second account with the same e-mail must return 409 Conflict.
    /// </summary>
    [Fact]
    public async Task Register_DuplicateEmail_Returns409()
    {
        var payload = Json(new
        {
            email = "dup_e2e@example.com",
            password = "Password123!",
            display_name = "User One"
        });

        var first = await _client.PostAsync("/api/auth/register", payload);
        Assert.Equal(HttpStatusCode.Created, first.StatusCode);

        // Reset the StringContent for the second request
        var second = await _client.PostAsync("/api/auth/register", Json(new
        {
            email = "dup_e2e@example.com",
            password = "Password123!",
            display_name = "User Two"
        }));
        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
    }

    /// <summary>
    /// Login with wrong password must return 401 Unauthorized.
    /// </summary>
    [Fact]
    public async Task Login_WrongPassword_Returns401()
    {
        await _client.PostAsync("/api/auth/register", Json(new
        {
            email = "pw_e2e@example.com",
            password = "Password123!",
            display_name = "PwUser"
        }));

        var resp = await _client.PostAsync("/api/auth/login", Json(new
        {
            email = "pw_e2e@example.com",
            password = "WrongPassword!"
        }));
        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    /// <summary>
    /// Creating an org without an Authorization header must return 401.
    /// </summary>
    [Fact]
    public async Task CreateOrg_WithoutAuth_Returns401()
    {
        // Create a fresh client with no Authorization header
        using var anonClient = _factory.CreateClient();

        var resp = await anonClient.PostAsync("/api/orgs", Json(new
        {
            name = "Should Fail",
            slug = "should-fail"
        }));
        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    /// <summary>
    /// A valid refresh token must exchange for a new access_token + refresh_token pair.
    /// </summary>
    [Fact]
    public async Task RefreshToken_ValidToken_ReturnsNewTokens()
    {
        // Register and capture the refresh token
        var regResp = await _client.PostAsync("/api/auth/register", Json(new
        {
            email = "refresh_e2e@example.com",
            password = "Password123!",
            display_name = "RefreshUser"
        }));
        Assert.Equal(HttpStatusCode.Created, regResp.StatusCode);

        var body = await regResp.Content.ReadFromJsonAsync<JsonElement>();
        var refreshToken = body.GetProperty("refresh_token").GetString();
        Assert.False(string.IsNullOrEmpty(refreshToken), "refresh_token must be present");

        // Exchange refresh token
        var refreshResp = await _client.PostAsync("/api/auth/refresh", Json(new
        {
            refresh_token = refreshToken
        }));
        Assert.Equal(HttpStatusCode.OK, refreshResp.StatusCode);

        var refreshBody = await refreshResp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(refreshBody.TryGetProperty("access_token", out _),
            "refresh response should contain access_token");
        Assert.True(refreshBody.TryGetProperty("refresh_token", out _),
            "refresh response should contain a new refresh_token");
    }

    /// <summary>
    /// Accessing a department's wiki without being a member must return 403 Forbidden.
    /// </summary>
    [Fact]
    public async Task WikiPages_NonMember_Returns403()
    {
        // Register org owner and create dept
        var ownerResp = await _client.PostAsync("/api/auth/register", Json(new
        {
            email = "owner_e2e@example.com",
            password = "Password123!",
            display_name = "Owner"
        }));
        Assert.Equal(HttpStatusCode.Created, ownerResp.StatusCode);

        var ownerBody = await ownerResp.Content.ReadFromJsonAsync<JsonElement>();
        var ownerToken = ownerBody.GetProperty("access_token").GetString()!;

        _client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", ownerToken);

        var orgResp = await _client.PostAsync("/api/orgs", Json(new
        {
            name = "Restricted Org",
            slug = "restricted-org-e2e"
        }));
        Assert.Equal(HttpStatusCode.Created, orgResp.StatusCode);
        var orgId = (await orgResp.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("id").GetString()!;

        var wikiPath = Path.Combine(Path.GetTempPath(), "e2e_restricted_" + Guid.NewGuid().ToString("N"));
        var deptResp = await _client.PostAsync($"/api/orgs/{orgId}/departments", Json(new
        {
            name = "Restricted Dept",
            slug = "restricted-dept",
            wiki_project_path = wikiPath
        }));
        Assert.Equal(HttpStatusCode.Created, deptResp.StatusCode);
        var deptId = (await deptResp.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("id").GetString()!;

        try
        {
            // Register a second user who is NOT a member
            var strangerResp = await _client.PostAsync("/api/auth/register", Json(new
            {
                email = "stranger_e2e@example.com",
                password = "Password123!",
                display_name = "Stranger"
            }));
            Assert.Equal(HttpStatusCode.Created, strangerResp.StatusCode);

            var strangerToken = (await strangerResp.Content.ReadFromJsonAsync<JsonElement>())
                .GetProperty("access_token").GetString()!;

            using var strangerClient = _factory.CreateClient();
            strangerClient.DefaultRequestHeaders.Authorization =
                new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", strangerToken);

            var forbiddenResp = await strangerClient.GetAsync($"/api/departments/{deptId}/wiki/pages");
            Assert.Equal(HttpStatusCode.Forbidden, forbiddenResp.StatusCode);
        }
        finally
        {
            if (Directory.Exists(wikiPath))
                Directory.Delete(wikiPath, recursive: true);
        }
    }
}
