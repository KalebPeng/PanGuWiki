namespace LlmWiki.Api.Services;

public class PdfExtractService
{
    public virtual Task<string> ExtractText(string path) =>
        Task.FromResult($"[PDF: {System.IO.Path.GetFileName(path)}]");

    public virtual Task<List<(int PageNumber, byte[] ImageBytes, string Format)>> ExtractImages(string path) =>
        Task.FromResult(new List<(int, byte[], string)>());
}
