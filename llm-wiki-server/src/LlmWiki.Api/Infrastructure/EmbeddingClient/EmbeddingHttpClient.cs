using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using LlmWiki.Api.Modules.Wiki.Entities;

namespace LlmWiki.Api.Infrastructure.EmbeddingClient;

public class EmbeddingHttpClient(HttpClient http) : IEmbeddingClient
{
    public async Task<float[][]> EmbedBatchAsync(
        EmbeddingConfig config, string[] texts, CancellationToken ct = default)
    {
        if (config.Provider == "google")
            return await EmbedGoogleAsync(config, texts, ct);
        return await EmbedOpenAiCompatAsync(config, texts, ct);
    }

    private async Task<float[][]> EmbedOpenAiCompatAsync(
        EmbeddingConfig config, string[] texts, CancellationToken ct)
    {
        var url = NormalizeOpenAiBase(config.Endpoint) + "/v1/embeddings";
        var body = new { model = config.Model, input = texts };

        using var request = new HttpRequestMessage(HttpMethod.Post, url);
        request.Headers.Authorization =
            new AuthenticationHeaderValue("Bearer", config.EncryptedApiKey);
        request.Content = new StringContent(
            JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");

        using var response = await http.SendAsync(request, ct);
        if (!response.IsSuccessStatusCode)
        {
            var err = await response.Content.ReadAsStringAsync(ct);
            throw new HttpRequestException(
                $"Embedding API error {(int)response.StatusCode} from {url}: {err}",
                null, response.StatusCode);
        }

        return ParseOpenAiResponse(await response.Content.ReadAsStringAsync(ct));
    }

    private async Task<float[][]> EmbedGoogleAsync(
        EmbeddingConfig config, string[] texts, CancellationToken ct)
    {
        var url = BuildGoogleBatchUrl(config.Endpoint, config.Model, config.EncryptedApiKey);
        var requests = texts.Select(t => new {
            model = $"models/{config.Model}",
            content = new { parts = new[] { new { text = t } } }
        }).ToArray();

        using var request = new HttpRequestMessage(HttpMethod.Post, url);
        request.Content = new StringContent(
            JsonSerializer.Serialize(new { requests }), Encoding.UTF8, "application/json");

        using var response = await http.SendAsync(request, ct);
        if (!response.IsSuccessStatusCode)
        {
            var err = await response.Content.ReadAsStringAsync(ct);
            throw new HttpRequestException(
                $"Google Embedding API error {(int)response.StatusCode} from {url}: {err}",
                null, response.StatusCode);
        }

        return ParseGoogleBatchResponse(await response.Content.ReadAsStringAsync(ct));
    }

    internal static float[][] ParseOpenAiResponse(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.GetProperty("data")
            .EnumerateArray()
            .OrderBy(e => e.GetProperty("index").GetInt32())
            .Select(e => e.GetProperty("embedding")
                .EnumerateArray()
                .Select(v => v.GetSingle())
                .ToArray())
            .ToArray();
    }

    internal static float[][] ParseGoogleBatchResponse(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.GetProperty("embeddings")
            .EnumerateArray()
            .Select(e => e.GetProperty("values")
                .EnumerateArray()
                .Select(v => v.GetSingle())
                .ToArray())
            .ToArray();
    }

    internal static string NormalizeOpenAiBase(string endpoint)
    {
        var s = endpoint.TrimEnd('/');
        return Regex.IsMatch(s, @"/v\d+$") ? s[..s.LastIndexOf('/')] : s;
    }

    internal static string BuildGoogleBatchUrl(string endpoint, string model, string apiKey)
    {
        var base_ = endpoint.TrimEnd('/');
        if (base_.EndsWith("/v1beta", StringComparison.OrdinalIgnoreCase))
            base_ = base_[..^7];
        return $"{base_}/v1beta/models/{model}:batchEmbedContents?key={apiKey}";
    }
}
