using System.Text.Json.Serialization;

namespace LlmWiki.Api.Services;

public class CloudWikiOptions
{
    public string? ApiKey { get; set; }
    public Dictionary<string, string> Projects { get; set; } = [];
}

public record CloudWikiPage(
    [property: JsonPropertyName("title")] string Title,
    [property: JsonPropertyName("relativePath")] string RelativePath,
    [property: JsonPropertyName("content")] string Content = "");

public record CloudWikiSearchResult(
    [property: JsonPropertyName("title")] string Title,
    [property: JsonPropertyName("relativePath")] string RelativePath,
    [property: JsonPropertyName("snippet")] string Snippet,
    [property: JsonPropertyName("score")] double Score);

public record CloudWikiSearchRequest(
    [property: JsonPropertyName("query")] string Query,
    [property: JsonPropertyName("limit")] int? Limit);

public class CloudWikiService(Microsoft.Extensions.Options.IOptions<CloudWikiOptions> options)
{
    private const int DefaultLimit = 10;
    private const int SnippetContext = 80;
    private readonly CloudWikiOptions _options = options.Value;

    public Task<IReadOnlyList<CloudWikiPage>> ListPages(string projectId)
    {
        var projectRoot = ResolveProjectRoot(projectId);
        var pages = EnumerateMarkdownPages(projectRoot)
            .Select(path =>
            {
                var content = File.ReadAllText(path);
                return new CloudWikiPage(
                    ExtractTitle(content, Path.GetFileName(path)),
                    ToProjectRelative(projectRoot, path));
            })
            .OrderBy(p => p.RelativePath, StringComparer.OrdinalIgnoreCase)
            .ToList();

        return Task.FromResult<IReadOnlyList<CloudWikiPage>>(pages);
    }

    public Task<IReadOnlyList<CloudWikiSearchResult>> Search(string projectId, CloudWikiSearchRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Query))
            throw new InvalidOperationException("Search query cannot be empty.");

        var projectRoot = ResolveProjectRoot(projectId);
        var query = request.Query.Trim();
        var queryLower = query.ToLowerInvariant();
        var tokens = Tokenize(query);
        var limit = Math.Clamp(request.Limit ?? DefaultLimit, 1, 50);

        var results = EnumerateMarkdownPages(projectRoot)
            .Select(path =>
            {
                var content = File.ReadAllText(path);
                var title = ExtractTitle(content, Path.GetFileName(path));
                return ScorePage(projectRoot, path, title, content, query, queryLower, tokens);
            })
            .Where(r => r is not null)
            .Cast<CloudWikiSearchResult>()
            .OrderByDescending(r => r.Score)
            .ThenBy(r => r.RelativePath, StringComparer.OrdinalIgnoreCase)
            .Take(limit)
            .ToList();

        return Task.FromResult<IReadOnlyList<CloudWikiSearchResult>>(results);
    }

    public Task<CloudWikiPage> ReadPage(string projectId, string pathOrTitle)
    {
        if (string.IsNullOrWhiteSpace(pathOrTitle))
            throw new InvalidOperationException("Page path or title cannot be empty.");

        var projectRoot = ResolveProjectRoot(projectId);
        var wikiRoot = Path.Combine(projectRoot, "wiki");
        var input = pathOrTitle.Trim();

        var pathCandidate = ResolvePathCandidate(projectRoot, input);
        if (pathCandidate is not null)
        {
            EnsureInside(wikiRoot, pathCandidate, "Path is outside wiki directory.");
            if (!File.Exists(pathCandidate))
                throw new FileNotFoundException($"Wiki page not found: {input}");
            return Task.FromResult(LoadPage(projectRoot, pathCandidate));
        }

        var inputLower = input.ToLowerInvariant();
        foreach (var path in EnumerateMarkdownPages(projectRoot))
        {
            var content = File.ReadAllText(path);
            var title = ExtractTitle(content, Path.GetFileName(path));
            var relative = ToProjectRelative(projectRoot, path);
            if (
                string.Equals(title, input, StringComparison.OrdinalIgnoreCase) ||
                string.Equals(Path.GetFileName(relative), input, StringComparison.OrdinalIgnoreCase) ||
                string.Equals(relative, input.Replace('\\', '/'), StringComparison.OrdinalIgnoreCase) ||
                title.ToLowerInvariant().Contains(inputLower))
            {
                return Task.FromResult(new CloudWikiPage(title, relative, content));
            }
        }

        throw new FileNotFoundException($"Wiki page not found: {input}");
    }

    public Task<string> GetOverview(string projectId)
    {
        var projectRoot = ResolveProjectRoot(projectId);
        var sections = new List<string>();
        foreach (var relative in new[] { "purpose.md", "wiki/overview.md", "wiki/index.md" })
        {
            var path = Path.Combine(projectRoot, relative);
            EnsureInside(projectRoot, path, "Overview path is outside project.");
            if (!File.Exists(path)) continue;
            sections.Add($"# {relative}\n\n{File.ReadAllText(path).Trim()}");
        }
        return Task.FromResult(string.Join("\n\n---\n\n", sections));
    }

    public bool IsAuthorized(string? authorizationHeader)
    {
        if (string.IsNullOrWhiteSpace(_options.ApiKey)) return false;
        const string prefix = "Bearer ";
        if (authorizationHeader is null || !authorizationHeader.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            return false;
        var token = authorizationHeader[prefix.Length..].Trim();
        return string.Equals(token, _options.ApiKey, StringComparison.Ordinal);
    }

    private string ResolveProjectRoot(string projectId)
    {
        if (!_options.Projects.TryGetValue(projectId, out var configuredPath) || string.IsNullOrWhiteSpace(configuredPath))
            throw new KeyNotFoundException($"Project is not configured: {projectId}");

        var projectRoot = Path.GetFullPath(configuredPath);
        var wikiRoot = Path.Combine(projectRoot, "wiki");
        if (!Directory.Exists(wikiRoot))
            throw new DirectoryNotFoundException($"Configured project has no wiki directory: {projectId}");

        return projectRoot;
    }

    private static IEnumerable<string> EnumerateMarkdownPages(string projectRoot)
    {
        var wikiRoot = Path.Combine(projectRoot, "wiki");
        return Directory.EnumerateFiles(wikiRoot, "*.md", SearchOption.AllDirectories)
            .Where(path => !Path.GetFileName(path).StartsWith('.'));
    }

    private static CloudWikiPage LoadPage(string projectRoot, string path)
    {
        var content = File.ReadAllText(path);
        return new CloudWikiPage(
            ExtractTitle(content, Path.GetFileName(path)),
            ToProjectRelative(projectRoot, path),
            content);
    }

    private static string? ResolvePathCandidate(string projectRoot, string input)
    {
        var looksPathLike = Path.IsPathRooted(input) || input.Contains('/') || input.Contains('\\');
        if (!looksPathLike) return null;
        return Path.GetFullPath(Path.IsPathRooted(input) ? input : Path.Combine(projectRoot, input));
    }

    private static CloudWikiSearchResult? ScorePage(
        string projectRoot,
        string path,
        string title,
        string content,
        string query,
        string queryLower,
        IReadOnlyList<string> tokens)
    {
        var relative = ToProjectRelative(projectRoot, path);
        var titleLower = title.ToLowerInvariant();
        var pathLower = relative.ToLowerInvariant();
        var contentLower = content.ToLowerInvariant();
        double score = 0;

        if (titleLower == queryLower) score += 200;
        if (titleLower.Contains(queryLower)) score += 80;
        if (pathLower.Contains(queryLower)) score += 50;
        if (contentLower.Contains(queryLower)) score += 25;

        foreach (var token in tokens)
        {
            if (titleLower.Contains(token)) score += 20;
            if (pathLower.Contains(token)) score += 10;
            if (contentLower.Contains(token)) score += 2;
        }

        if (score <= 0) return null;
        return new CloudWikiSearchResult(title, relative, BuildSnippet(content, query, tokens), score);
    }

    private static string ExtractTitle(string content, string fileName)
    {
        var normalized = content.ReplaceLineEndings("\n");
        if (normalized.StartsWith("---\n"))
        {
            var end = normalized.IndexOf("\n---", 4, StringComparison.Ordinal);
            if (end > 0)
            {
                var frontmatter = normalized[4..end];
                foreach (var line in frontmatter.Split('\n'))
                {
                    if (!line.StartsWith("title:", StringComparison.OrdinalIgnoreCase)) continue;
                    return line["title:".Length..].Trim().Trim('"', '\'');
                }
            }
        }

        foreach (var line in normalized.Split('\n'))
        {
            if (line.StartsWith("# ", StringComparison.Ordinal))
                return line[2..].Trim();
        }

        return Path.GetFileNameWithoutExtension(fileName).Replace('-', ' ');
    }

    private static IReadOnlyList<string> Tokenize(string query)
    {
        char[] separators = [' ', ',', '，', '。', '！', '？', '、', ';', '；', ':', '：', '/', '\\', '-', '_', '(', ')', '（', '）'];
        var parts = query.ToLowerInvariant()
            .Split(separators, StringSplitOptions.RemoveEmptyEntries);
        var tokens = new HashSet<string>(parts);

        foreach (var part in parts.Where(p => p.Any(ch => ch >= '\u4e00' && ch <= '\u9fff')))
        {
            foreach (var ch in part) tokens.Add(ch.ToString());
            for (var i = 0; i < part.Length - 1; i++) tokens.Add(part.Substring(i, 2));
        }

        return tokens.ToList();
    }

    private static string BuildSnippet(string content, string query, IReadOnlyList<string> tokens)
    {
        var probes = new[] { query.ToLowerInvariant() }.Concat(tokens);
        var lower = content.ToLowerInvariant();
        foreach (var probe in probes.Where(p => !string.IsNullOrWhiteSpace(p)))
        {
            var idx = lower.IndexOf(probe, StringComparison.Ordinal);
            if (idx < 0) continue;
            var start = Math.Max(0, idx - SnippetContext);
            var end = Math.Min(content.Length, idx + probe.Length + SnippetContext);
            var prefix = start > 0 ? "..." : "";
            var suffix = end < content.Length ? "..." : "";
            return prefix + content[start..end].ReplaceLineEndings(" ") + suffix;
        }

        return content[..Math.Min(content.Length, SnippetContext * 2)].ReplaceLineEndings(" ").Trim();
    }

    private static string ToProjectRelative(string projectRoot, string path) =>
        Path.GetRelativePath(projectRoot, path).Replace('\\', '/');

    private static void EnsureInside(string root, string candidate, string message)
    {
        var resolvedRoot = Path.GetFullPath(root);
        var resolvedCandidate = Path.GetFullPath(candidate);
        var relative = Path.GetRelativePath(resolvedRoot, resolvedCandidate);
        if (relative == "." || (!relative.StartsWith("..") && !Path.IsPathRooted(relative))) return;
        throw new InvalidOperationException(message);
    }
}
