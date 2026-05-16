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
            try
            {
                await foreach (var evt in broadcaster.SubscribeAsync(deptId, 0, cts.Token))
                {
                    received.Add(evt);
                    cts.Cancel();  // 收到第一条后取消
                }
            }
            catch (OperationCanceledException) { }
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

        var counts = new int[2];
        var received = new SemaphoreSlim(0, 2);  // each subscriber signals when it receives
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));

        var tasks = Enumerable.Range(0, 2).Select(i => Task.Run(async () =>
        {
            try
            {
                await foreach (var evt in broadcaster.SubscribeAsync(deptId, 0, cts.Token))
                {
                    counts[i]++;
                    received.Release();  // signal that this subscriber got the event
                    break;               // stop iterating
                }
            }
            catch (OperationCanceledException) { }
        })).ToArray();

        await Task.Delay(50); // wait for subscribers to register
        broadcaster.Publish(deptId, broadcaster.CreateEvent(taskId, "done", "ok"));

        // wait for both subscribers to receive the event, then cancel
        await received.WaitAsync(cts.Token);
        await received.WaitAsync(cts.Token);
        await cts.CancelAsync();

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
            try
            {
                await foreach (var evt in broadcaster.SubscribeAsync(deptId, evt1.Id, cts.Token))
                {
                    received.Add(evt);
                    if (received.Count >= 2) cts.Cancel();
                }
            }
            catch (OperationCanceledException) { }
        });

        await task.WaitAsync(TimeSpan.FromSeconds(3));
        Assert.Equal(2, received.Count);
        Assert.Equal("s2", received[0].Step);
        Assert.Equal("s3", received[1].Step);
    }
}
