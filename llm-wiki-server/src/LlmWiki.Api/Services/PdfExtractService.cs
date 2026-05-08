using UglyToad.PdfPig;
using UglyToad.PdfPig.Content;

namespace LlmWiki.Api.Services;

public class PdfExtractService
{
    public virtual Task<string> ExtractText(string path)
    {
        try
        {
            using var doc = PdfDocument.Open(path);
            var sb = new System.Text.StringBuilder();
            foreach (var page in doc.GetPages())
            {
                sb.AppendLine($"## Page {page.Number}");
                sb.AppendLine();
                var words = page.GetWords().Select(w => w.Text);
                sb.AppendLine(string.Join(" ", words));
                sb.AppendLine();
            }
            return Task.FromResult(sb.ToString());
        }
        catch (Exception ex)
        {
            return Task.FromResult($"[PDF extraction failed: {ex.Message}]");
        }
    }

    public virtual Task<List<(int PageNumber, byte[] ImageBytes, string Format)>> ExtractImages(string path)
    {
        var images = new List<(int, byte[], string)>();
        try
        {
            using var doc = PdfDocument.Open(path);
            foreach (var page in doc.GetPages())
            {
                foreach (var img in page.GetImages())
                {
                    if (img.TryGetPng(out var png) && png is not null)
                        images.Add((page.Number, png, "png"));
                }
            }
        }
        catch { /* return what we have */ }
        return Task.FromResult(images);
    }
}
