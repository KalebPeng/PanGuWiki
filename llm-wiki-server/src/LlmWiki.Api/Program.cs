using LlmWiki.Api.Hubs;
using LlmWiki.Api.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers()
    .AddJsonOptions(opts =>
        opts.JsonSerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.SnakeCaseLower);

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
builder.Services.AddScoped<ClaudeWebSocket>();

var app = builder.Build();

app.UseCors();
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

app.Run("http://localhost:5200");

public partial class Program { }
