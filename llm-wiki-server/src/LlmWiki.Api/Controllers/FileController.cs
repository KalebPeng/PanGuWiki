using ClosedXML.Excel;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;
using LlmWiki.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System.Text;

namespace LlmWiki.Api.Controllers;

[Authorize]
[ApiController]
[Route("api/file")]
public class FileController(FileService fileService) : ControllerBase
{
    [HttpGet("read")]
    public async Task<IActionResult> Read([FromQuery] string path)
    {
        try { return Ok(await fileService.ReadFile(path)); }
        catch (Exception ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpPost("write")]
    public async Task<IActionResult> Write([FromBody] WriteRequest req)
    {
        try { await fileService.WriteFile(req.Path, req.Contents); return Ok(); }
        catch (Exception ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpGet("list")]
    public async Task<IActionResult> List([FromQuery] string path)
    {
        try { return Ok(await fileService.ListDirectory(path)); }
        catch (Exception ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpPost("copy")]
    public async Task<IActionResult> Copy([FromBody] CopyRequest req)
    {
        try { await fileService.CopyFile(req.Source, req.Destination); return Ok(); }
        catch (Exception ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpPost("copy-directory")]
    public async Task<IActionResult> CopyDirectory([FromBody] CopyRequest req)
    {
        try { return Ok(await fileService.CopyDirectory(req.Source, req.Destination)); }
        catch (Exception ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpPost("preprocess")]
    public async Task<IActionResult> Preprocess([FromBody] PathRequest req)
    {
        try { return Ok(await fileService.PreprocessFile(req.Path)); }
        catch (Exception ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpDelete]
    public async Task<IActionResult> Delete([FromQuery] string path)
    {
        try { await fileService.DeleteFile(path); return Ok(); }
        catch (Exception ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpGet("exists")]
    public async Task<IActionResult> Exists([FromQuery] string path) =>
        Ok(await fileService.FileExists(path));

    [HttpGet("base64")]
    public async Task<IActionResult> Base64([FromQuery] string path)
    {
        try
        {
            var (b64, mime) = await fileService.ReadFileAsBase64(path);
            return Ok(new { base64 = b64, mimeType = mime });
        }
        catch (Exception ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpPost("find-related")]
    public async Task<IActionResult> FindRelated([FromBody] FindRelatedRequest req) =>
        Ok(await fileService.FindRelatedWikiPages(req.ProjectPath, req.SourceName));

    [HttpPost("create-directory")]
    public async Task<IActionResult> CreateDirectory([FromBody] PathRequest req)
    {
        try { await fileService.CreateDirectory(req.Path); return Ok(); }
        catch (Exception ex) { return BadRequest(new { error = ex.Message }); }
    }

    [AllowAnonymous]  // token 通过 query string 传入，自行验证
    [HttpGet("preview")]
    public IActionResult Preview([FromQuery] string path, [FromQuery] string? token,
        [FromServices] LlmWiki.Api.Modules.Identity.JwtService jwtService)
    {
        try
        {
            // 验证 token（支持 query string 传入供新标签页使用）
            if (!string.IsNullOrWhiteSpace(token))
            {
                var handler = new System.IdentityModel.Tokens.Jwt.JwtSecurityTokenHandler();
                try { handler.ValidateToken(token, jwtService.GetValidationParameters(), out _); }
                catch { return Unauthorized(); }
            }
            else { return Unauthorized(); }

            fileService.EnsureSafeRead(path);
            var ext = Path.GetExtension(path).TrimStart('.').ToLowerInvariant();

            // PDF：直接返回，浏览器原生渲染
            if (ext == "pdf")
            {
                var bytes = System.IO.File.ReadAllBytes(path);
                return File(bytes, "application/pdf");
            }

            // Excel：ClosedXML → HTML 表格
            if (ext is "xlsx" or "xls")
            {
                var html = ExcelToHtml(path);
                return Content(html, "text/html; charset=utf-8");
            }

            // Word：提取段落 → HTML
            if (ext is "docx")
            {
                var html = DocxToHtml(path);
                return Content(html, "text/html; charset=utf-8");
            }

            // 其他文本文件
            var text = System.IO.File.ReadAllText(path);
            var escaped = System.Web.HttpUtility.HtmlEncode(text);
            return Content($"<html><body><pre style='font-family:monospace;white-space:pre-wrap;padding:16px'>{escaped}</pre></body></html>",
                "text/html; charset=utf-8");
        }
        catch (Exception ex) { return BadRequest(new { error = ex.Message }); }
    }

    private static string ExcelToHtml(string path)
    {
        var sb = new StringBuilder();
        sb.Append("<html><head><meta charset='utf-8'><style>table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:6px 10px;font-size:13px}th{background:#f5f5f5;font-weight:600}tr:nth-child(even){background:#fafafa}body{font-family:sans-serif;padding:16px}</style></head><body>");
        using var wb = new XLWorkbook(path);
        foreach (var ws in wb.Worksheets)
        {
            sb.Append($"<h3 style='margin:16px 0 8px'>{System.Web.HttpUtility.HtmlEncode(ws.Name)}</h3>");
            sb.Append("<table>");
            var range = ws.RangeUsed();
            if (range == null) continue;
            var firstRow = true;
            foreach (var row in range.Rows())
            {
                sb.Append("<tr>");
                foreach (var cell in row.Cells())
                {
                    var tag = firstRow ? "th" : "td";
                    var val = System.Web.HttpUtility.HtmlEncode(cell.GetString());
                    sb.Append($"<{tag}>{val}</{tag}>");
                }
                sb.Append("</tr>");
                firstRow = false;
            }
            sb.Append("</table>");
        }
        sb.Append("</body></html>");
        return sb.ToString();
    }

    private static string DocxToHtml(string path)
    {
        var sb = new StringBuilder();
        sb.Append("<html><head><meta charset='utf-8'><style>body{font-family:sans-serif;padding:24px;max-width:800px;margin:0 auto;line-height:1.6}p{margin:0 0 8px}</style></head><body>");
        using var doc = WordprocessingDocument.Open(path, false);
        var body = doc.MainDocumentPart?.Document?.Body;
        if (body != null)
        {
            foreach (var para in body.Elements<Paragraph>())
            {
                var text = string.Concat(para.Descendants<DocumentFormat.OpenXml.Wordprocessing.Text>().Select(t => t.Text));
                var encoded = System.Web.HttpUtility.HtmlEncode(text);
                sb.Append(string.IsNullOrWhiteSpace(text) ? "<br>" : $"<p>{encoded}</p>");
            }
        }
        sb.Append("</body></html>");
        return sb.ToString();
    }

    [HttpPost("rename")]
    public IActionResult Rename([FromBody] CopyRequest req)
    {
        try { fileService.Rename(req.Source, req.Destination); return Ok(); }
        catch (Exception ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpPost("move")]
    public IActionResult Move([FromBody] CopyRequest req)
    {
        try { fileService.MoveFile(req.Source, req.Destination); return Ok(); }
        catch (Exception ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpPost("upload")]
    [RequestSizeLimit(500_000_000)]
    public async Task<IActionResult> Upload([FromForm] string destDir, IFormFileCollection files)
    {
        try { return Ok(await fileService.UploadFiles(destDir, files)); }
        catch (Exception ex) { return BadRequest(new { error = ex.Message }); }
    }
}

public record WriteRequest(string Path, string Contents);
public record CopyRequest(string Source, string Destination);
public record PathRequest(string Path);
public record FindRelatedRequest(string ProjectPath, string SourceName);
