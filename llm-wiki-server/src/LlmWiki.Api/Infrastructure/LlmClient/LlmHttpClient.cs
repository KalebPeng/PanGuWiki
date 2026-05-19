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
            await foreach (var token in StreamAnthropicAsync(config, messages, options, ct))
                yield return token;
            yield break;
        }

        if (config.Provider == "google")
        {
            await foreach (var token in StreamGeminiAsync(config, messages, options, ct))
                yield return token;
            yield break;
        }

        await foreach (var token in StreamOpenAiCompatAsync(config, messages, options, ct))
            yield return token;
    }

    // Strip trailing /vN so users can paste either "https://api.x.com" or
    // "https://api.x.com/v1" without getting a doubled /v1/v1 path.
    private static string NormalizeOpenAiBase(string endpoint)
    {
        var s = endpoint.TrimEnd('/');
        return System.Text.RegularExpressions.Regex.IsMatch(s, @"/v\d+$")
            ? s[..s.LastIndexOf('/')]
            : s;
    }

    private async IAsyncEnumerable<string> StreamOpenAiCompatAsync(
        LlmConfig config,
        IEnumerable<ChatMessage> messages,
        LlmOptions options,
        [EnumeratorCancellation] CancellationToken ct)
    {
        var url = NormalizeOpenAiBase(config.Endpoint) + "/v1/chat/completions";
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
        if (!response.IsSuccessStatusCode)
        {
            var errorBody = await response.Content.ReadAsStringAsync(ct);
            throw new HttpRequestException(
                $"LLM API error {(int)response.StatusCode} from {url}: {errorBody}",
                null, response.StatusCode);
        }

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

    private async IAsyncEnumerable<string> StreamAnthropicAsync(
        LlmConfig config,
        IEnumerable<ChatMessage> messages,
        LlmOptions options,
        [EnumeratorCancellation] CancellationToken ct)
    {
        var url = AnthropicUrlBuilder.Build(config.Endpoint);
        var msgList = messages.ToList();
        var system = string.Join("\n", msgList
            .Where(m => m.Role == "system")
            .Select(m => m.Content));
        var conversation = msgList
            .Where(m => m.Role != "system")
            .Select(m => new { role = m.Role, content = m.Content })
            .ToList();

        var body = new Dictionary<string, object>
        {
            ["model"] = config.Model,
            ["messages"] = conversation,
            ["stream"] = true,
            ["max_tokens"] = options.MaxTokens,
            ["temperature"] = (double)options.Temperature,
        };
        if (!string.IsNullOrEmpty(system)) body["system"] = system;

        using var request = new HttpRequestMessage(HttpMethod.Post, url);
        // MiniMax/DashScope proxies expect Bearer; standard Anthropic expects x-api-key
        var requiresBearer = url.Contains("minimax", StringComparison.OrdinalIgnoreCase)
                          || url.Contains("dashscope", StringComparison.OrdinalIgnoreCase);
        if (requiresBearer)
            request.Headers.Authorization =
                new AuthenticationHeaderValue("Bearer", config.EncryptedApiKey);
        else
        {
            request.Headers.Add("x-api-key", config.EncryptedApiKey);
            request.Headers.Add("anthropic-version", "2023-06-01");
        }
        request.Content = new StringContent(
            JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");

        using var response = await http.SendAsync(
            request, HttpCompletionOption.ResponseHeadersRead, ct);
        if (!response.IsSuccessStatusCode)
        {
            var errorBody = await response.Content.ReadAsStringAsync(ct);
            throw new HttpRequestException(
                $"LLM API error {(int)response.StatusCode} from {url}: {errorBody}",
                null, response.StatusCode);
        }

        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        using var reader = new StreamReader(stream);

        string? currentEvent = null;
        while (!reader.EndOfStream && !ct.IsCancellationRequested)
        {
            var line = await reader.ReadLineAsync(ct);
            if (line is null) break;

            if (line.StartsWith("event:"))
            {
                currentEvent = line[6..].Trim();
                if (currentEvent == "message_stop") yield break;
                continue;
            }

            if (line.StartsWith("data:") && currentEvent == "content_block_delta")
            {
                var token = ParseAnthropicDeltaLine(line);
                if (token != null) yield return token;
            }
        }
    }

    internal static string? ParseAnthropicDeltaLine(string line)
    {
        if (!line.StartsWith("data: ")) return null;
        var data = line[6..].Trim();
        try
        {
            using var doc = JsonDocument.Parse(data);
            var root = doc.RootElement;
            if (root.TryGetProperty("delta", out var delta) &&
                delta.TryGetProperty("type", out var type) &&
                type.GetString() == "text_delta" &&
                delta.TryGetProperty("text", out var text))
                return text.GetString();
            return null;
        }
        catch { return null; }
    }

    internal static string BuildGeminiUrl(string endpoint, string model, string apiKey)
    {
        var base_ = endpoint.TrimEnd('/');
        if (base_.EndsWith("/v1beta", StringComparison.OrdinalIgnoreCase))
            base_ = base_[..^7];
        return $"{base_}/v1beta/models/{model}:streamGenerateContent?key={apiKey}&alt=sse";
    }

    private async IAsyncEnumerable<string> StreamGeminiAsync(
        LlmConfig config,
        IEnumerable<ChatMessage> messages,
        LlmOptions options,
        [EnumeratorCancellation] CancellationToken ct)
    {
        var url = BuildGeminiUrl(config.Endpoint, config.Model, config.EncryptedApiKey);
        var msgList = messages.ToList();
        var systemText = string.Join("\n", msgList
            .Where(m => m.Role == "system")
            .Select(m => m.Content));
        var contents = msgList
            .Where(m => m.Role != "system")
            .Select(m => new {
                role = m.Role == "assistant" ? "model" : m.Role,
                parts = new[] { new { text = m.Content } }
            })
            .ToList();

        var body = new Dictionary<string, object>
        {
            ["contents"] = contents,
            ["generationConfig"] = new {
                temperature = (double)options.Temperature,
                maxOutputTokens = options.MaxTokens,
            }
        };
        if (!string.IsNullOrEmpty(systemText))
            body["system_instruction"] = new { parts = new[] { new { text = systemText } } };

        using var request = new HttpRequestMessage(HttpMethod.Post, url);
        request.Content = new StringContent(
            JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");

        using var response = await http.SendAsync(
            request, HttpCompletionOption.ResponseHeadersRead, ct);
        if (!response.IsSuccessStatusCode)
        {
            var errorBody = await response.Content.ReadAsStringAsync(ct);
            throw new HttpRequestException(
                $"LLM API error {(int)response.StatusCode} from {url}: {errorBody}",
                null, response.StatusCode);
        }

        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        using var reader = new StreamReader(stream);

        while (!reader.EndOfStream && !ct.IsCancellationRequested)
        {
            var line = await reader.ReadLineAsync(ct);
            if (line is null) break;
            var token = ParseGeminiLine(line);
            if (token != null) yield return token;
        }
    }

    internal static string? ParseGeminiLine(string line)
    {
        if (!line.StartsWith("data: ")) return null;
        var data = line[6..].Trim();
        try
        {
            using var doc = JsonDocument.Parse(data);
            var parts = doc.RootElement
                .GetProperty("candidates")[0]
                .GetProperty("content")
                .GetProperty("parts");
            return parts.GetArrayLength() > 0 &&
                   parts[0].TryGetProperty("text", out var text)
                       ? text.GetString()
                       : null;
        }
        catch { return null; }
    }
}
