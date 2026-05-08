using LlmWiki.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace LlmWiki.Api.Controllers;

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
}

public record WriteRequest(string Path, string Contents);
public record CopyRequest(string Source, string Destination);
public record PathRequest(string Path);
public record FindRelatedRequest(string ProjectPath, string SourceName);
