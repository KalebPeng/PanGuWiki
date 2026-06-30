using LlmWiki.Api.Infrastructure;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.DependencyInjection;

namespace LlmWiki.Api.Tests;

/// <summary>
/// Shared EF Core model customizer that makes the model compatible with
/// in-memory SQLite used in tests by:
/// <list type="bullet">
///   <item>Stripping PostgreSQL SQL-function defaults (<c>gen_random_uuid()</c>, <c>now()</c>, etc.)</item>
///   <item>Removing CHECK constraints that use PostgreSQL-only functions (e.g. <c>num_nonnulls()</c>)</item>
///   <item>Removing partial index filters that SQLite cannot evaluate</item>
/// </list>
/// </summary>
internal sealed class TestSqliteModelCustomizer(ModelCustomizerDependencies dependencies)
    : ModelCustomizer(dependencies)
{
    public override void Customize(ModelBuilder modelBuilder, DbContext context)
    {
        base.Customize(modelBuilder, context);

        foreach (var entity in modelBuilder.Model.GetEntityTypes())
        {
            // Strip PostgreSQL SQL-function defaults
            foreach (var prop in entity.GetProperties())
            {
                if (prop.GetDefaultValueSql() is not null)
                    prop.SetDefaultValueSql(null);
            }

            // Remove CHECK constraints (PostgreSQL-specific functions like num_nonnulls)
            foreach (var check in entity.GetCheckConstraints().ToList())
                entity.RemoveCheckConstraint(check.ModelName);

            // Remove partial index filters (SQLite ignores WHERE clauses in EF-generated DDL)
            foreach (var index in entity.GetIndexes())
            {
                if (index.GetFilter() is not null)
                    index.SetFilter(null);
            }
        }
    }
}


public sealed class TestWebApplicationFactory : WebApplicationFactory<Program>, IAsyncDisposable
{
    private readonly SqliteConnection _keepAlive;

    public string ImageAssetRoot { get; } = Path.Combine(Path.GetTempPath(), "llmwiki-image-assets-tests", Guid.NewGuid().ToString("N"));
    public HttpMessageHandler? OpenAiImagesHandler { get; set; }

    public TestWebApplicationFactory()
    {
        _keepAlive = new SqliteConnection("DataSource=:memory:");
        _keepAlive.Open();
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseSetting("Jwt:Secret", "test-secret-minimum-32-characters!!");
        builder.UseSetting("Jwt:Issuer", "llmwiki");
        builder.UseSetting("Jwt:Audience", "llmwiki");
        builder.UseSetting("WikiProjects:RootPath", Path.GetTempPath());
        builder.UseSetting("ImageAssets:RootPath", ImageAssetRoot);
        builder.UseSetting("DataProtection:KeysPath", Path.Combine(Path.GetTempPath(), "llmwiki-test-keys"));
        builder.UseEnvironment("Testing");

        builder.ConfigureServices(services =>
        {
            // Remove the PostgreSQL DbContext options registered in Program.cs
            var toRemove = services
                .Where(d => d.ServiceType == typeof(DbContextOptions<AppDbContext>))
                .ToList();
            foreach (var d in toRemove)
                services.Remove(d);

            // Replace with in-memory SQLite using the shared keep-alive connection
            services.AddDbContext<AppDbContext>(options =>
            {
                options.UseSqlite(_keepAlive);
                options.UseSnakeCaseNamingConvention();
                // Strip PostgreSQL SQL-function defaults (gen_random_uuid, now(), etc.)
                options.ReplaceService<IModelCustomizer, TestSqliteModelCustomizer>();
            });

            if (OpenAiImagesHandler is not null)
            {
                services.AddTransient(_ => OpenAiImagesHandler);
                services.AddHttpClient<LlmWiki.Api.Infrastructure.ImageGeneration.OpenAiImagesClient>()
                    .ConfigurePrimaryHttpMessageHandler(sp => sp.GetRequiredService<HttpMessageHandler>());
            }
        });
    }

    public new async ValueTask DisposeAsync()
    {
        await base.DisposeAsync();
        await _keepAlive.DisposeAsync();
        if (Directory.Exists(ImageAssetRoot))
            Directory.Delete(ImageAssetRoot, recursive: true);
    }
}
