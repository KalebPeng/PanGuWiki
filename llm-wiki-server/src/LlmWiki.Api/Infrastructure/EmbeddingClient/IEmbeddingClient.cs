using LlmWiki.Api.Modules.Wiki.Entities;

namespace LlmWiki.Api.Infrastructure.EmbeddingClient;

public interface IEmbeddingClient
{
    // Returns one float[] per input text, in the same order as texts.
    Task<float[][]> EmbedBatchAsync(
        EmbeddingConfig config,
        string[] texts,
        CancellationToken ct = default);
}
