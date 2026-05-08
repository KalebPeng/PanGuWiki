namespace LlmWiki.Api.Models;

public record FileNode(string Name, string Path, bool IsDir, List<FileNode>? Children);
