using LlmWiki.Api.Hubs;
using LlmWiki.Api.Infrastructure;
using LlmWiki.Api.Modules.Identity;
using LlmWiki.Api.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
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

var app = builder.Build();

app.UseCors();
app.UseAuthentication();
app.UseAuthorization();
app.UseMiddleware<TenantMiddleware>();
app.UseWebSockets();
app.MapControllers();
app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

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
