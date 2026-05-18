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
    // Falls back to a non-atomic SELECT approach for non-PostgreSQL providers (e.g. SQLite in tests).
    private static async Task<LlmWiki.Api.Modules.Wiki.Entities.IngestTask?> TryClaimNextTaskAsync(
        AppDbContext db, CancellationToken ct)
    {
        // Use atomic PostgreSQL claim when available; fall back for test/SQLite environments.
        var isNpgsql = db.Database.ProviderName?.Contains("Npgsql") == true;

        if (isNpgsql)
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

        // Non-atomic fallback for non-PostgreSQL providers (test/SQLite only).
        // Race conditions are acceptable here since this path is only used in tests.
        var task = await db.IngestTasks
            .Where(t => t.Status == "queued")
            .OrderBy(t => t.QueuedAt)
            .FirstOrDefaultAsync(ct);

        if (task is null) return null;

        task.Status = "running";
        task.LockedBy = InstanceId;
        task.StartedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return task;
    }
}
