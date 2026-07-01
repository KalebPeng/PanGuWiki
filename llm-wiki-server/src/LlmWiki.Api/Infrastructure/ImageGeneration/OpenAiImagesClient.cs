using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;

namespace LlmWiki.Api.Infrastructure.ImageGeneration;

public record GeneratedImagePayload(byte[] Bytes, string MimeType, string? SourceUrl);

public sealed class ImageGenerationRelayException(string message, Exception? innerException = null)
    : InvalidOperationException(message, innerException);

public class OpenAiImagesClient(HttpClient httpClient)
{
    private const long MaxRelayResponseBytes = 64L * 1024 * 1024;
    private const long MaxImageBytes = 10L * 1024 * 1024;

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

        try
        {
            using var response = await httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
            if (!response.IsSuccessStatusCode)
            {
                throw new ImageGenerationRelayException($"Image generation relay returned {(int)response.StatusCode}.");
            }

            var responseBytes = await ReadBoundedContentAsync(
                response.Content,
                MaxRelayResponseBytes,
                "Image generation relay response was too large.",
                ct);

            using var document = JsonDocument.Parse(responseBytes);
            if (!document.RootElement.TryGetProperty("data", out var data) ||
                data.ValueKind != JsonValueKind.Array)
            {
                throw new ImageGenerationRelayException("Image generation relay response did not include data.");
            }

            var images = new List<GeneratedImagePayload>();
            foreach (var item in data.EnumerateArray())
            {
                if (item.TryGetProperty("b64_json", out var b64Json) &&
                    b64Json.ValueKind == JsonValueKind.String &&
                    !string.IsNullOrWhiteSpace(b64Json.GetString()))
                {
                    images.Add(new GeneratedImagePayload(DecodeBase64Image(b64Json.GetString()!), "image/png", null));
                    continue;
                }

                if (item.TryGetProperty("url", out var urlElement) &&
                    urlElement.ValueKind == JsonValueKind.String &&
                    !string.IsNullOrWhiteSpace(urlElement.GetString()))
                {
                    var sourceUrl = urlElement.GetString()!;
                    var bytes = await DownloadImageAsync(sourceUrl, ct);
                    images.Add(new GeneratedImagePayload(bytes, GetMimeType(sourceUrl), sourceUrl));
                    continue;
                }

                throw new ImageGenerationRelayException("Image generation relay response item did not include image data.");
            }

            return images;
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (ImageGenerationRelayException)
        {
            throw;
        }
        catch (Exception ex) when (ex is JsonException or FormatException or HttpRequestException or TaskCanceledException or OperationCanceledException)
        {
            throw new ImageGenerationRelayException("Image generation relay response could not be processed.", ex);
        }
    }

    private async Task<byte[]> DownloadImageAsync(string sourceUrl, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, sourceUrl);
        using var response = await httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
        if (!response.IsSuccessStatusCode)
        {
            throw new ImageGenerationRelayException($"Image generation relay image download returned {(int)response.StatusCode}.");
        }

        return await ReadBoundedContentAsync(
            response.Content,
            MaxImageBytes,
            "Image generation relay image was too large.",
            ct);
    }

    private static async Task<byte[]> ReadBoundedContentAsync(
        HttpContent content,
        long maxBytes,
        string tooLargeMessage,
        CancellationToken ct)
    {
        if (content.Headers.ContentLength is > 0 && content.Headers.ContentLength > maxBytes)
        {
            throw new ImageGenerationRelayException(tooLargeMessage);
        }

        await using var stream = await content.ReadAsStreamAsync(ct);
        using var buffer = new MemoryStream();
        var chunk = new byte[81920];
        while (true)
        {
            var read = await stream.ReadAsync(chunk, ct);
            if (read == 0)
            {
                return buffer.ToArray();
            }

            if (buffer.Length + read > maxBytes)
            {
                throw new ImageGenerationRelayException(tooLargeMessage);
            }

            buffer.Write(chunk, 0, read);
        }
    }

    private static byte[] DecodeBase64Image(string value)
    {
        var trimmed = value.Trim();
        if (trimmed.Length / 4.0 * 3 > MaxImageBytes)
        {
            throw new ImageGenerationRelayException("Image generation relay image was too large.");
        }

        var bytes = Convert.FromBase64String(trimmed);
        if (bytes.LongLength > MaxImageBytes)
        {
            throw new ImageGenerationRelayException("Image generation relay image was too large.");
        }

        return bytes;
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
