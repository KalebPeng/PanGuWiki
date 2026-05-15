using System.Net.Http.Headers;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using LlmWiki.Api.Modules.Wiki.Entities;

namespace LlmWiki.Api.Infrastructure.LlmClient;

public class LlmHttpClient(HttpClient http) : ILlmClient
{
    public async IAsyncEnumerable<string> StreamChatAsync(
        LlmConfig config,
        IEnumerable<ChatMessage> messages,
        LlmOptions options,
        [EnumeratorCancellation] CancellationToken ct = default)
    {
        if (config.Provider == "anthropic")
        {
            // Anthropic branch added in Task 5
            throw new NotSupportedException($"Anthropic provider not yet implemented — will be added in Task 5");
        }

        await foreach (var token in StreamOpenAiCompatAsync(config, messages, options, ct))
            yield return token;
    }

    private async IAsyncEnumerable<string> StreamOpenAiCompatAsync(
        LlmConfig config,
        IEnumerable<ChatMessage> messages,
        LlmOptions options,
        [EnumeratorCancellation] CancellationToken ct)
    {
        var url = config.Endpoint.TrimEnd('/') + "/v1/chat/completions";
        var body = new
        {
            model = config.Model,
            messages = messages.Select(m => new { role = m.Role, content = m.Content }),
            stream = true,
            temperature = options.Temperature,
            max_tokens = options.MaxTokens,
        };

        using var request = new HttpRequestMessage(HttpMethod.Post, url);
        request.Headers.Authorization =
            new AuthenticationHeaderValue("Bearer", config.EncryptedApiKey);
        request.Content = new StringContent(
            JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");

        using var response = await http.SendAsync(
            request, HttpCompletionOption.ResponseHeadersRead, ct);
        response.EnsureSuccessStatusCode();

        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        using var reader = new StreamReader(stream);

        while (!reader.EndOfStream && !ct.IsCancellationRequested)
        {
            var line = await reader.ReadLineAsync(ct);
            if (line is null) break;
            var token = ParseOpenAiLine(line);
            if (token == null) continue;
            if (token == "[DONE]") yield break;
            yield return token;
        }
    }

    // internal so tests can call it directly
    internal static string? ParseOpenAiLine(string line)
    {
        if (!line.StartsWith("data: ")) return null;
        var data = line[6..].Trim();
        if (data == "[DONE]") return "[DONE]";
        try
        {
            using var doc = JsonDocument.Parse(data);
            return doc.RootElement
                .GetProperty("choices")[0]
                .GetProperty("delta")
                .TryGetProperty("content", out var content)
                    ? content.GetString()
                    : null;
        }
        catch { return null; }
    }
}
