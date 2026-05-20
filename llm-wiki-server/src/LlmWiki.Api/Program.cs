using LlmWiki.Api.Hubs;
using LlmWiki.Api.Infrastructure;
using LlmWiki.Api.Infrastructure.EmbeddingClient;
using LlmWiki.Api.Infrastructure.IngestWorker;
using LlmWiki.Api.Infrastructure.LlmClient;
using LlmWiki.Api.Modules.Identity;
using LlmWiki.Api.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

// Refuse to start in non-Development with the placeholder JWT secret
var jwtSecret = builder.Configuration["Jwt:Secret"];
if (!builder.Environment.IsDevelopment() &&
    (string.IsNullOrWhiteSpace(jwtSecret) || jwtSecret.StartsWith("CHANGEME")))
{
    throw new InvalidOperationException(
        "Jwt:Secret must be set to a secure value in non-Development environments. " +
        "Override via environment variable Jwt__Secret.");
}

builder.Services.AddControllers()
    .AddJsonOptions(opts =>
        opts.JsonSerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.SnakeCaseLower);

// PostgreSQL / EF Core
builder.Services.AddDbContext<AppDbContext>(opts =>
    opts.UseNpgsql(builder.Configuration.GetConnectionString("Default"))
        .UseSnakeCaseNamingConvention());

// HTTP context access + identity infrastructure (Scoped)
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<TenantContext>();
builder.Services.AddScoped<ITenantContext>(sp => sp.GetRequiredService<TenantContext>());
builder.Services.AddScoped<ICurrentUser, CurrentUserService>();

// Identity services (Singleton — stateless)
builder.Services.AddSingleton<JwtService>();
builder.Services.AddSingleton<PasswordService>();

// JWT Bearer authentication
var jwtService = new JwtService(builder.Configuration);
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(opts =>
    {
        opts.TokenValidationParameters = jwtService.GetValidationParameters();
    });
builder.Services.AddAuthorization();

builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        var configuredOrigins = builder.Configuration.GetSection("Cors:Origins").Get<string[]>();
        var origins = configuredOrigins is { Length: > 0 }
            ? configuredOrigins
            : [
                "tauri://localhost",
                "https://tauri.localhost",
                "http://localhost:1420",
                "http://localhost:5173"
            ];

        if (origins.Contains("*"))
        {
            policy.AllowAnyOrigin();
        }
        else
        {
            policy.WithOrigins(origins);
        }

        policy
            .AllowAnyHeader()
            .AllowAnyMethod();
    });
});

builder.Services.AddSingleton<ProjectService>();
builder.Services.AddScoped<FileService>();
builder.Services.AddSingleton<ProxyService>();
builder.Services.AddSingleton<ClaudeCliService>();
builder.Services.AddSingleton<PdfExtractService>();
builder.Services.AddSingleton<OfficeExtractService>();
builder.Services.AddSingleton<VectorService>();
builder.Services.Configure<WikiProjectsOptions>(builder.Configuration.GetSection("WikiProjects"));
builder.Services.Configure<CloudWikiOptions>(builder.Configuration.GetSection("LlmWikiCloud"));
builder.Services.AddSingleton<CloudWikiService>();
builder.Services.AddScoped<ClaudeWebSocket>();

// DataProtection — key ring must be persisted, otherwise container rebuilds cannot decrypt DB-stored keys
var keysPath = builder.Configuration["DataProtection:KeysPath"] ?? "/data/keys";
builder.Services.AddDataProtection()
    .PersistKeysToFileSystem(new System.IO.DirectoryInfo(keysPath));

builder.Services.AddSingleton<LlmConfigService>();
builder.Services.AddSingleton<IngestEventBroadcaster>();
builder.Services.AddSingleton<SseTokenService>();

// Ingest Worker
builder.Services.AddHttpClient<ILlmClient, LlmHttpClient>(c =>
    c.Timeout = TimeSpan.FromMinutes(10));
builder.Services.AddHttpClient<IEmbeddingClient, EmbeddingHttpClient>(c =>
    c.Timeout = TimeSpan.FromMinutes(5));
builder.Services.AddScoped<IngestPipelineService>();
builder.Services.AddSingleton<IngestWorkerService>();
builder.Services.AddSingleton<IIngestQueue>(sp => sp.GetRequiredService<IngestWorkerService>());
builder.Services.AddHostedService(sp => sp.GetRequiredService<IngestWorkerService>());

var app = builder.Build();

// 启动时自动执行 EF Core 迁移（Docker 部署时确保数据库表最新）
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    if (app.Environment.IsEnvironment("Testing"))
        db.Database.EnsureCreated();
    else
        db.Database.Migrate();

    // 若数据库中尚无超级管理员，且配置了 INITIAL_ADMIN_EMAIL / INITIAL_ADMIN_PASSWORD
    // 则自动创建初始超管账号（仅在第一次部署时生效）
    var adminEmail = builder.Configuration["InitialAdmin:Email"];
    var adminPassword = builder.Configuration["InitialAdmin:Password"];
    var adminName = builder.Configuration["InitialAdmin:DisplayName"] ?? "Admin";

    if (!string.IsNullOrWhiteSpace(adminEmail) && !string.IsNullOrWhiteSpace(adminPassword))
    {
        var hasSuperAdmin = db.Users.Any(u => u.IsSuperAdmin);
        if (!hasSuperAdmin)
        {
            var passwordService = scope.ServiceProvider.GetRequiredService<PasswordService>();
            db.Users.Add(new LlmWiki.Api.Modules.Identity.Entities.AppUser
            {
                Id = Guid.NewGuid(),
                Email = adminEmail.ToLowerInvariant().Trim(),
                DisplayName = adminName,
                PasswordHash = passwordService.Hash(adminPassword),
                IsActive = true,
                IsSuperAdmin = true,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow,
            });
            db.SaveChanges();
            Console.WriteLine($"[Seed] 初始超管账号已创建：{adminEmail}");
        }
    }
}

app.UseCors();
app.UseAuthentication();
app.UseAuthorization();
app.UseMiddleware<TenantMiddleware>();
app.UseWebSockets();
app.MapControllers();
app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

app.MapGet("/api/health/ingest-worker", (IngestWorkerService worker) =>
    Results.Ok(new
    {
        workerAlive = worker.IsAlive,
        lastCompletedAt = worker.LastCompletedAt,
        currentTaskId = worker.CurrentTaskId,
    }));

app.Map("/ws/claude", async context =>
{
    if (!context.WebSockets.IsWebSocketRequest)
    {
        context.Response.StatusCode = 400;
        return;
    }
    var ws = await context.WebSockets.AcceptWebSocketAsync();
    var hub = context.RequestServices.GetRequiredService<ClaudeWebSocket>();
    await hub.Handle(ws);
});

app.Run();

public partial class Program { }
