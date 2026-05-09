using LlmWiki.Api.Models;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace LlmWiki.Api.Services;

public class WikiProjectsOptions
{
    public string RootPath { get; set; } = "/data/wiki";
}

public class ProjectService(IOptions<WikiProjectsOptions>? options = null, ILogger<ProjectService>? logger = null)
{
    private readonly ILogger<ProjectService> _logger = logger ?? NullLogger<ProjectService>.Instance;
    private readonly WikiProjectsOptions _options = options?.Value ?? new();

    public string GetProjectRootPath() => NormalizePath(Path.GetFullPath(_options.RootPath));

    public IReadOnlyList<WikiProject> DiscoverProjects()
    {
        var root = Path.GetFullPath(_options.RootPath);
        if (!Directory.Exists(root))
        {
            _logger.LogInformation("Project root does not exist. Root={Root}", root);
            return [];
        }

        var projects = Directory.EnumerateDirectories(root)
            .Where(IsValidWikiProjectDirectory)
            .Select(path => new WikiProject(new DirectoryInfo(path).Name, NormalizePath(path)))
            .OrderBy(project => project.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();

        _logger.LogInformation(
            "Discovered wiki projects. Root={Root} Count={Count} Projects=[{Projects}]",
            root,
            projects.Count,
            string.Join(", ", projects.Select(project => project.Path)));

        return projects;
    }

    public WikiProject CreateProject(string name, string basePath)
    {
        // Validate name to prevent path traversal
        if (string.IsNullOrWhiteSpace(name))
            throw new InvalidOperationException("Project name cannot be empty.");
        if (name.Contains('/') || name.Contains('\\') || name.Contains(".."))
            throw new InvalidOperationException($"Invalid project name '{name}': must not contain path separators or '..'.");

        var root = Path.Combine(basePath, name);
        _logger.LogInformation(
            "Creating wiki project. Name={ProjectName} BasePath={BasePath} Root={Root} CurrentDirectory={CurrentDirectory}",
            name,
            basePath,
            root,
            Directory.GetCurrentDirectory());

        if (Directory.Exists(root))
            throw new InvalidOperationException($"Directory already exists: '{root}'");

        string[] dirs = [
            "raw/sources", "raw/assets",
            "wiki/entities", "wiki/concepts", "wiki/sources",
            "wiki/queries", "wiki/comparisons", "wiki/synthesis"
        ];
        foreach (var d in dirs)
            Directory.CreateDirectory(Path.Combine(root, d));

        var today = DateTime.Now.ToString("yyyy-MM-dd");

        WriteFile(root, "schema.md", SchemaContent());
        WriteFile(root, "purpose.md", PurposeContent());
        WriteFile(root, "wiki/index.md", "# Wiki Index\n\n## Entities\n\n## Concepts\n\n## Sources\n\n## Queries\n\n## Comparisons\n\n## Synthesis\n");
        WriteFile(root, "wiki/log.md", $"# Research Log\n\n## {today}\n\n- Project created\n");
        WriteFile(root, "wiki/overview.md", "---\ntype: overview\ntitle: Project Overview\ntags: []\nrelated: []\n---\n\n# Overview\n\n<!-- High-level summary -->\n");

        Directory.CreateDirectory(Path.Combine(root, ".obsidian"));
        WriteFile(root, ".obsidian/app.json", """{"attachmentFolderPath":"raw/assets","useMarkdownLinks":false,"newLinkFormat":"shortest"}""");
        WriteFile(root, ".obsidian/appearance.json", """{"baseFontSize":16,"theme":"obsidian"}""");

        var createdEntries = Directory.Exists(root)
            ? Directory.EnumerateFileSystemEntries(root).Select(Path.GetFileName).ToArray()
            : [];

        _logger.LogInformation(
            "Wiki project created. Root={Root} Exists={Exists} Entries=[{Entries}]",
            root,
            Directory.Exists(root),
            string.Join(", ", createdEntries));

        return new WikiProject(name, NormalizePath(root));
    }

    public WikiProject OpenProject(string path)
    {
        if (!Directory.Exists(path))
            throw new InvalidOperationException($"Path does not exist: '{path}'");
        if (!IsValidWikiProjectDirectory(path))
            throw new InvalidOperationException($"Not a valid wiki project: '{path}'");

        var name = new DirectoryInfo(path).Name;
        return new WikiProject(name, NormalizePath(path));
    }

    private static bool IsValidWikiProjectDirectory(string path)
    {
        var identityFile = Path.Combine(path, ".llm-wiki", "project.json");
        if (File.Exists(identityFile))
            return true;

        return File.Exists(Path.Combine(path, "schema.md"))
            && File.Exists(Path.Combine(path, "purpose.md"))
            && Directory.Exists(Path.Combine(path, "wiki"))
            && Directory.Exists(Path.Combine(path, "raw"));
    }

    private static void WriteFile(string root, string relative, string content)
    {
        var full = Path.Combine(root, relative);
        Directory.CreateDirectory(Path.GetDirectoryName(full)!);
        File.WriteAllText(full, content);
    }

    private static string NormalizePath(string p) => p.Replace('\\', '/');

    private static string SchemaContent() => """
        # Wiki Schema

        ## Page Types

        | Type | Directory | Purpose |
        |------|-----------|---------|
        | entity | wiki/entities/ | Named things |
        | concept | wiki/concepts/ | Ideas and techniques |
        | source | wiki/sources/ | Papers and articles |
        | query | wiki/queries/ | Open questions |
        | comparison | wiki/comparisons/ | Side-by-side analysis |
        | synthesis | wiki/synthesis/ | Cross-cutting summaries |

        ## Frontmatter

        ```yaml
        ---
        type: entity
        title: Title
        tags: []
        related: []
        created: YYYY-MM-DD
        updated: YYYY-MM-DD
        ---
        ```
        """;

    private static string PurposeContent() => """
        # Project Purpose

        ## Goal

        <!-- What are you trying to understand or build? -->

        ## Key Questions

        1.
        2.
        3.

        ## Thesis

        > TBD
        """;
}
