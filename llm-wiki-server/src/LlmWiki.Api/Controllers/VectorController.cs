using LlmWiki.Api.Models;
using LlmWiki.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace LlmWiki.Api.Controllers;

[ApiController]
[Route("api/vector")]
public class VectorController(VectorService vectorService) : ControllerBase
{
    // v2 chunk endpoints
    [HttpPost("chunks/upsert")]
    public async Task<IActionResult> UpsertChunks([FromBody] ChunkUpsertRequest req)
    {
        try { await vectorService.UpsertChunks(req.ProjectPath, req.PageId, req.Chunks); return Ok(); }
        catch (Exception ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpPost("chunks/search")]
    public async Task<IActionResult> SearchChunks([FromBody] ChunkSearchRequest req)
    {
        try { return Ok(await vectorService.SearchChunks(req.ProjectPath, req.QueryEmbedding, req.TopK)); }
        catch (Exception ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpDelete("chunks/{pageId}")]
    public async Task<IActionResult> DeletePage(string pageId, [FromQuery] string projectPath)
    {
        try { await vectorService.DeletePage(projectPath, pageId); return Ok(); }
        catch (Exception ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpGet("chunks/count")]
    public async Task<IActionResult> CountChunks([FromQuery] string projectPath)
    {
        try { return Ok(await vectorService.CountChunks(projectPath)); }
        catch (Exception ex) { return BadRequest(new { error = ex.Message }); }
    }

    // v1 legacy stubs
    [HttpPost("upsert")]
    public Task<IActionResult> Upsert([FromBody] VectorUpsertRequest req) =>
        Task.FromResult<IActionResult>(Ok());

    [HttpPost("search")]
    public Task<IActionResult> Search([FromBody] VectorSearchRequest req) =>
        Task.FromResult<IActionResult>(Ok(Array.Empty<VectorSearchResult>()));

    [HttpDelete("{pageId}")]
    public Task<IActionResult> Delete(string pageId) =>
        Task.FromResult<IActionResult>(Ok());

    [HttpGet("count")]
    public Task<IActionResult> Count([FromQuery] string projectPath) =>
        Task.FromResult<IActionResult>(Ok(0));

    [HttpGet("legacy/count")]
    public Task<IActionResult> LegacyCount([FromQuery] string projectPath) =>
        Task.FromResult<IActionResult>(Ok(0));

    [HttpDelete("legacy")]
    public Task<IActionResult> DropLegacy([FromQuery] string projectPath) =>
        Task.FromResult<IActionResult>(Ok());
}
