using LlmWiki.Api.Infrastructure;
using LlmWiki.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace LlmWiki.Api.Modules.Wiki;

[ApiController]
[Authorize]
[Route("api/departments/{deptId:guid}/migrate")]
public class MigrateController(
    VectorService vectorService,
    ITenantContext tenant,
    CloudWikiService wikiService) : ControllerBase
{
    /// <summary>POST api/departments/{deptId}/migrate</summary>
    /// <remarks>
    /// Drops the old (non-dept-scoped) vector collection for the department's wiki project,
    /// so that the frontend can re-index pages under the new dept-scoped collection name.
    /// The actual re-indexing is done by the frontend after this call returns.
    /// </remarks>
    [HttpPost]
    [RequireDeptRole("admin")]
    public async Task<IActionResult> Migrate(Guid deptId)
    {
        if (tenant.WikiProjectPath is null)
            return Forbid();

        // Count pages to report back
        var pages = await wikiService.ListPagesByPath(tenant.WikiProjectPath);
        int pageCount = pages.Count;

        // Check how many chunks exist in the old (non-dept-scoped) collection
        ulong oldChunks = await vectorService.CountChunks(tenant.WikiProjectPath);

        // Drop the old collection (non-dept-scoped naming) if it exists
        await vectorService.DropCollection(tenant.WikiProjectPath);

        return Ok(new
        {
            migrated_pages = pageCount,
            old_chunks_removed = (long)oldChunks,
            message = "旧向量集合已清理，请在 Wiki 页面重新触发索引",
        });
    }
}
