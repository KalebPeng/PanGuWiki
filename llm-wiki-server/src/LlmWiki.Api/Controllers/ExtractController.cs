using LlmWiki.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace LlmWiki.Api.Controllers;

public record ExtractPathRequest(string Path);
public record ExtractSaveRequest(string Path, string DestDir, string UrlPrefix);

[ApiController]
[Route("api/extract")]
public class ExtractController(PdfExtractService pdfExtract, OfficeExtractService officeExtract) : ControllerBase
{
    [HttpPost("pdf-images")]
    public async Task<IActionResult> PdfImages([FromBody] ExtractPathRequest req)
    {
        try
        {
            var images = await pdfExtract.ExtractImages(req.Path);
            return Ok(images.Select(i => new { page = i.PageNumber, format = i.Format }));
        }
        catch (Exception ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpPost("office-images")]
    public IActionResult OfficeImages([FromBody] ExtractPathRequest req) =>
        Ok(Array.Empty<object>());

    [HttpPost("pdf-images/save")]
    public async Task<IActionResult> PdfImagesSave([FromBody] ExtractSaveRequest req)
    {
        try
        {
            var images = await pdfExtract.ExtractImages(req.Path);
            Directory.CreateDirectory(req.DestDir);
            var saved = new List<string>();
            foreach (var (page, bytes, fmt) in images)
            {
                var file = System.IO.Path.Combine(req.DestDir, $"page-{page}.{fmt}");
                await System.IO.File.WriteAllBytesAsync(file, bytes);
                saved.Add(file.Replace('\\', '/'));
            }
            return Ok(saved);
        }
        catch (Exception ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpPost("office-images/save")]
    public IActionResult OfficeImagesSave([FromBody] ExtractSaveRequest req) =>
        Ok(Array.Empty<string>());
}
