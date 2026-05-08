namespace LlmWiki.Api.Models;

public record WikiProject(string Name, string Path);

public record CreateProjectRequest(string Name, string Path);

public record OpenProjectRequest(string Path);
