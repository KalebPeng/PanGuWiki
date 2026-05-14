using LlmWiki.Api.Infrastructure;
using LlmWiki.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace LlmWiki.Api.Modules.Wiki;

// ── Request / Response records ────────────────────────────────────────────────

public record DeptWikiSearchRequest(string Query, int? Limit);

public record DeptWikiPageSummary(string Title, string RelativePath);

// ── Controller ────────────────────────────────────────────────────────────────

[ApiController]
[Route("api/departments/{deptId:guid}/wiki")]
[Authorize]
public class DeptWikiController(CloudWikiService wikiService, ITenantContext tenant) : ControllerBase
{
    /// <summary>GET api/departments/{deptId}/wiki/pages</summary>
    [HttpGet("pages")]
    [RequireDeptRole]
    public async Task<IActionResult> ListPages()
    {
        if (tenant.WikiProjectPath is null)
            return Forbid();

        var pages = await wikiService.ListPagesByPath(tenant.WikiProjectPath);
        var summaries = pages.Select(p => new DeptWikiPageSummary(p.Title, p.RelativePath));
        return Ok(new { pages = summaries });
    }

    /// <summary>GET api/departments/{deptId}/wiki/pages/read?path_or_title=xxx</summary>
    [HttpGet("pages/read")]
    [RequireDeptRole]
    public async Task<IActionResult> ReadPage(
        [FromQuery(Name = "path_or_title")] string? pathOrTitle)
    {
        if (tenant.WikiProjectPath is null)
            return Forbid();

        if (string.IsNullOrWhiteSpace(pathOrTitle))
            return BadRequest(new { error = "path_or_title query parameter is required." });

        var page = await wikiService.ReadPageByPath(tenant.WikiProjectPath, pathOrTitle);
        if (page is null)
            return NotFound(new { error = $"Wiki page not found: {pathOrTitle}" });

        return Ok(page);
    }

    /// <summary>POST api/departments/{deptId}/wiki/search</summary>
    [HttpPost("search")]
    [RequireDeptRole]
    public async Task<IActionResult> Search([FromBody] DeptWikiSearchRequest request)
    {
        if (tenant.WikiProjectPath is null)
            return Forbid();

        if (string.IsNullOrWhiteSpace(request.Query))
            return BadRequest(new { error = "query cannot be empty." });

        var results = await wikiService.SearchByPath(
            tenant.WikiProjectPath, request.Query, request.Limit);

        return Ok(new { results });
    }

    /// <summary>GET api/departments/{deptId}/wiki/overview</summary>
    [HttpGet("overview")]
    [RequireDeptRole]
    public async Task<IActionResult> Overview()
    {
        if (tenant.WikiProjectPath is null)
            return Forbid();

        var content = await wikiService.GetOverviewByPath(tenant.WikiProjectPath);
        return Ok(new { content });
    }
}
