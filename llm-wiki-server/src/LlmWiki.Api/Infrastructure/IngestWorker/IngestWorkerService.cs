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
