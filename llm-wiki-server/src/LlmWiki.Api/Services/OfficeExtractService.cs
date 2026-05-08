using ClosedXML.Excel;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Presentation;
using DocumentFormat.OpenXml.Wordprocessing;

namespace LlmWiki.Api.Services;

public class OfficeExtractService
{
    public virtual Task<string> ExtractText(string path, string ext) =>
        Task.FromResult(ext switch
        {
            "docx" => ExtractDocx(path),
            "pptx" => ExtractPptx(path),
            "xlsx" or "ods" => ExtractSpreadsheet(path),
            _ => $"[Unsupported: .{ext}]"
        });

    private static string ExtractDocx(string path)
    {
        try
        {
            using var doc = WordprocessingDocument.Open(path, isEditable: false);
            var body = doc.MainDocumentPart?.Document?.Body;
            if (body is null) return "[Could not read DOCX]";
            var sb = new System.Text.StringBuilder();
            foreach (var para in body.Elements<Paragraph>())
            {
                var text = para.InnerText.Trim();
                if (text.Length == 0) continue;
                var styleId = para.ParagraphProperties?.ParagraphStyleId?.Val?.Value ?? "";
                if (styleId.Contains("Heading", StringComparison.OrdinalIgnoreCase))
                {
                    var levelChar = styleId.LastOrDefault(char.IsAsciiDigit);
                    var level = levelChar != '\0' ? (levelChar - '0') : 1;
                    sb.AppendLine($"{new string('#', level)} {text}");
                }
                else
                {
                    sb.AppendLine(text);
                }
                sb.AppendLine();
            }
            return sb.Length > 0 ? sb.ToString() : "[Could not extract text from DOCX]";
        }
        catch (Exception ex) { return $"[DOCX extraction failed: {ex.Message}]"; }
    }

    private static string ExtractPptx(string path)
    {
        try
        {
            using var prs = PresentationDocument.Open(path, isEditable: false);
            var sb = new System.Text.StringBuilder();
            var slides = prs.PresentationPart?.SlideParts?.ToList() ?? [];
            for (var i = 0; i < slides.Count; i++)
            {
                sb.AppendLine($"## Slide {i + 1}");
                var texts = slides[i].Slide
                    .Descendants<DocumentFormat.OpenXml.Drawing.Text>()
                    .Select(t => t.Text.Trim())
                    .Where(t => t.Length > 0);
                foreach (var t in texts) sb.AppendLine($"- {t}");
                sb.AppendLine();
            }
            return sb.Length > 0 ? sb.ToString() : "[Could not extract text from PPTX]";
        }
        catch (Exception ex) { return $"[PPTX extraction failed: {ex.Message}]"; }
    }

    private static string ExtractSpreadsheet(string path)
    {
        try
        {
            using var wb = new XLWorkbook(path);
            var sb = new System.Text.StringBuilder();
            var sheets = wb.Worksheets.ToList();
            foreach (var ws in sheets)
            {
                if (sheets.Count > 1) sb.AppendLine($"## {ws.Name}");
                var usedRange = ws.RangeUsed();
                if (usedRange is null) continue;
                var rows = usedRange.RowsUsed().ToList();
                for (var r = 0; r < rows.Count; r++)
                {
                    var cells = rows[r].Cells().Select(c => c.GetString().Replace("|", "\\|"));
                    sb.Append("| ").Append(string.Join(" | ", cells)).AppendLine(" |");
                    if (r == 0)
                    {
                        var cols = rows[r].Cells().Count();
                        sb.Append('|').Append(string.Concat(Enumerable.Repeat(" --- |", cols))).AppendLine();
                    }
                }
                sb.AppendLine();
            }
            return sb.Length > 0 ? sb.ToString() : "[Could not extract data from spreadsheet]";
        }
        catch (Exception ex) { return $"[Spreadsheet extraction failed: {ex.Message}]"; }
    }
}
