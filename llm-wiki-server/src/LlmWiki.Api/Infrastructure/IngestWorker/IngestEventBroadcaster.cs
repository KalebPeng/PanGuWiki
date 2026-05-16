using System.Collections.Concurrent;
using System.Runtime.CompilerServices;
using System.Threading.Channels;

namespace LlmWiki.Api.Infrastructure.IngestWorker;

public record IngestEvent(
    long Id,
    Guid TaskId,
    string Step,       // "analyzing" | "generating" | "writing" | "done" | "failed"
    string Detail,
    DateTimeOffset Timestamp);

public class IngestEventBroadcaster
{
    private const int MaxRecentEvents = 100;

    // 每条 SSE 连接独立 Channel，key = connectionId
    private readonly ConcurrentDictionary<Guid, (Guid DeptId, Channel<IngestEvent> Ch)>
        _connections = new();

    // 近期 MaxRecentEvents 条事件缓冲，用于断线重连回放
    private readonly ConcurrentDictionary<Guid, LinkedList<IngestEvent>> _recentEvents = new();
    private readonly object _bufferLock = new();

    private long _eventCounter;

    public IngestEvent CreateEvent(Guid taskId, string step, string detail) =>
        new(Interlocked.Increment(ref _eventCounter), taskId, step, detail, DateTimeOffset.UtcNow);

    public void Publish(Guid deptId, IngestEvent evt)
    {
        // 更新近期事件缓冲（最多 100 条）
        var buf = _recentEvents.GetOrAdd(deptId, _ => new LinkedList<IngestEvent>());
        lock (_bufferLock)
        {
            buf.AddLast(evt);
            while (buf.Count > MaxRecentEvents) buf.RemoveFirst();
        }

        foreach (var (_, (d, ch)) in _connections)
            if (d == deptId) ch.Writer.TryWrite(evt);
    }

    public async IAsyncEnumerable<IngestEvent> SubscribeAsync(
        Guid deptId,
        long lastEventId,
        [EnumeratorCancellation] CancellationToken ct)
    {
        var connId = Guid.NewGuid();
        var channel = Channel.CreateBounded<IngestEvent>(new BoundedChannelOptions(500)
        {
            FullMode = BoundedChannelFullMode.DropOldest,
            SingleReader = true,
            SingleWriter = false,
        });
        _connections[connId] = (deptId, channel);

        // 回放客户端断线期间错过的事件
        if (_recentEvents.TryGetValue(deptId, out var recent))
        {
            lock (_bufferLock)
            {
                foreach (var evt in recent.Where(e => e.Id > lastEventId))
                    channel.Writer.TryWrite(evt);
            }
        }

        try
        {
            await foreach (var evt in channel.Reader.ReadAllAsync(ct))
                yield return evt;
        }
        finally
        {
            _connections.TryRemove(connId, out _);
            channel.Writer.TryComplete();
        }
    }

    public int ConnectionCount(Guid deptId) =>
        _connections.Values.Count(v => v.DeptId == deptId);
}
