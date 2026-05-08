namespace LlmWiki.Api.Services;

public class OfficeExtractService
{
    public virtual Task<string> ExtractText(string path, string ext) =>
        Task.FromResult($"[{ext.ToUpperInvariant()}: {System.IO.Path.GetFileName(path)}]");
}
