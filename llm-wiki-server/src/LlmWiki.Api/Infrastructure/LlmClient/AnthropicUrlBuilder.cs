using System.Text.RegularExpressions;

namespace LlmWiki.Api.Infrastructure.LlmClient;

public static partial class AnthropicUrlBuilder
{
    // Already contains /vN/messages → return as-is
    // Already contains /vN         → append /messages
    // Other (bare host, /anthropic, etc.) → append /v1/messages
    public static string Build(string baseUrl)
    {
        var trimmed = baseUrl.TrimEnd('/');
        if (VersionMessages().IsMatch(trimmed)) return trimmed;
        if (VersionOnly().IsMatch(trimmed)) return trimmed + "/messages";
        return trimmed + "/v1/messages";
    }

    [GeneratedRegex(@"/v\d+/messages$", RegexOptions.IgnoreCase)]
    private static partial Regex VersionMessages();

    [GeneratedRegex(@"/v\d+$", RegexOptions.IgnoreCase)]
    private static partial Regex VersionOnly();
}
