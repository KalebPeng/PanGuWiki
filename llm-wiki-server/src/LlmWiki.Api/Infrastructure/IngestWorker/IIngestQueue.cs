namespace LlmWiki.Api.Infrastructure.IngestWorker;

public interface IIngestQueue
{
    /// <summary>通知 worker 有新任务。信号模式，幂等，不阻塞。</summary>
    void Signal();
}
