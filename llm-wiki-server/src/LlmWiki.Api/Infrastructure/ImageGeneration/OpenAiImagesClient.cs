using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;

namespace LlmWiki.Api.Infrastructure.ImageGeneration;

public record GeneratedImagePayload(byte[] Bytes, string MimeType, string? SourceUrl);

public class OpenAiImagesClient(HttpClient httpClient)
{
    public async Task<IReadOnlyList<GeneratedImagePayload>> GenerateAsync(
        string baseUrl,
        string apiKey,
        string model,
        string prompt,
        string size,
        int n,
        CancellationToken ct)
    {
        var endpoint = $"{baseUrl.TrimEnd('/')}/v1/images/generations";
        using var request = new HttpRequestMessage(HttpMethod.Post, endpoint)
        {
            Content = JsonContent.Create(new
            {
                model,
                prompt,
                size,
                n,
            }),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);

        using var response = await httpClient.SendAsync(request, ct);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException($"Image generation relay returned {(int)response.StatusCode}.");
        }

        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        using var document = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
        if (!document.RootElement.TryGetProperty("data", out var data) ||
            data.ValueKind != JsonValueKind.Array)
        {
            throw new InvalidOperationException("Image generation relay response did not include data.");
        }

        var images = new List<GeneratedImagePayload>();
        foreach (var item in data.EnumerateArray())
        {
            if (item.TryGetProperty("b64_json", out var b64Json) &&
                b64Json.ValueKind == JsonValueKind.String &&
                !string.IsNullOrWhiteSpace(b64Json.GetString()))
            {
                images.Add(new GeneratedImagePayload(
                    Convert.FromBase64String(b64Json.GetString()!),
                    "image/png",
                    null));
                continue;
            }

            if (item.TryGetProperty("url", out var urlElement) &&
                urlElement.ValueKind == JsonValueKind.String &&
                !string.IsNullOrWhiteSpace(urlElement.GetString()))
            {
                var sourceUrl = urlElement.GetString()!;
                var bytes = await httpClient.GetByteArrayAsync(sourceUrl, ct);
                images.Add(new GeneratedImagePayload(bytes, GetMimeType(sourceUrl), sourceUrl));
                continue;
            }

            throw new InvalidOperationException("Image generation relay response item did not include image data.");
        }

        return images;
    }

    private static string GetMimeType(string sourceUrl)
    {
        var path = Uri.TryCreate(sourceUrl, UriKind.Absolute, out var uri)
            ? uri.AbsolutePath
            : sourceUrl;
        var extension = Path.GetExtension(path);
        return string.Equals(extension, ".jpg", StringComparison.OrdinalIgnoreCase) ||
               string.Equals(extension, ".jpeg", StringComparison.OrdinalIgnoreCase)
            ? "image/jpeg"
            : "image/png";
    }
}
