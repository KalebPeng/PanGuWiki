using LlmWiki.Api.Infrastructure;
using LlmWiki.Api.Modules.Wiki.Entities;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;

namespace LlmWiki.Api.Tests;

/// <summary>
/// Tests for startup recovery logic in IngestWorkerService.
/// Uses SQLite (in-memory, shared connection per test) because ExecuteUpdateAsync
/// requires a relational provider — the InMemory provider does not support bulk updates.
/// The TestSqliteModelCustomizer strips PostgreSQL-specific SQL that SQLite can't handle.
/// </summary>
public class IngestWorkerStartupRecoveryTests : IDisposable
{
    private readonly SqliteConnection _connection;

    public IngestWorkerStartupRecoveryTests()
    {
        _connection = new SqliteConnection("DataSource=:memory:");
        _connection.Open();

        // Create schema once on this connection
        using var db = CreateDb();
        db.Database.EnsureCreated();
    }

    public void Dispose() => _connection.Dispose();

    private AppDbContext CreateDb()
    {
        var opts = new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlite(_connection)
            .UseSnakeCaseNamingConvention()
            .ReplaceService<IModelCustomizer, TestSqliteModelCustomizer>()
            .Options;
        return new AppDbContext(opts);
    }

    [Fact]
    public async Task Startup_ResetsOwnRunningTasks_LeavesOtherInstanceTasks()
    {
        const string myId = "instance-A";
        const string otherId = "instance-B";

        // Arrange: seed two running tasks with different instance IDs
        await using (var db = CreateDb())
        {
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
        }

        // Act: simulate startup recovery — only reset own tasks
        await using (var db = CreateDb())
        {
            await db.IngestTasks
                .Where(t => t.Status == "running" && t.LockedBy == myId)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(t => t.Status, "queued")
                    .SetProperty(t => t.LockedBy, (string?)null));
        }

        // Assert: read fresh from DB
        await using (var db = CreateDb())
        {
            var tasks = await db.IngestTasks.AsNoTracking().ToListAsync();
            Assert.Equal("queued", tasks.Single(t => t.SourceFileName == "mine.md").Status);
            Assert.Null(tasks.Single(t => t.SourceFileName == "mine.md").LockedBy);
            Assert.Equal("running", tasks.Single(t => t.SourceFileName == "other.md").Status);
            Assert.Equal(otherId, tasks.Single(t => t.SourceFileName == "other.md").LockedBy);
        }
    }

    [Fact]
    public async Task Startup_NoOwnTasks_DoesNothing()
    {
        // Arrange
        await using (var db = CreateDb())
        {
            db.IngestTasks.Add(new IngestTask
            {
                Id = Guid.NewGuid(), DepartmentId = Guid.NewGuid(),
                Status = "running", LockedBy = "other-instance",
                SourceFileName = "no-own-f.md", SourceFilePath = "no-own-f.md",
                QueuedAt = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
        }

        // Act: no tasks locked by "my-instance" should be reset
        int reset;
        await using (var db = CreateDb())
        {
            reset = await db.IngestTasks
                .Where(t => t.Status == "running" && t.LockedBy == "my-instance")
                .ExecuteUpdateAsync(s => s.SetProperty(t => t.Status, "queued"));
        }

        // Assert
        Assert.Equal(0, reset);

        await using (var db = CreateDb())
        {
            Assert.Equal("running",
                (await db.IngestTasks.AsNoTracking()
                    .SingleAsync(t => t.SourceFileName == "no-own-f.md")).Status);
        }
    }
}
