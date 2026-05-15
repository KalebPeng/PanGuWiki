using LlmWiki.Api.Modules.Wiki.Entities;

namespace LlmWiki.Api.Infrastructure.LlmClient;

public record ChatMessage(string Role, string Content);

public record LlmOptions(
    float Temperature = 0.1f,
    int MaxTokens = 8192);

public interface ILlmClient
{
    IAsyncEnumerable<string> StreamChatAsync(
        LlmConfig config,
        IEnumerable<ChatMessage> messages,
        LlmOptions options,
        CancellationToken ct = default);
}
