using LlmWiki.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace LlmWiki.Api.Controllers;

[ApiController]
[Route("api/projects/{projectId}/wiki")]
public class CloudWikiController(CloudWikiService cloudWikiService) : ControllerBase
{
    [HttpGet("pages")]
    public async Task<IActionResult> ListPages([FromRoute] string projectId) =>
        await Handle(projectId, async () => Ok(new { pages = await cloudWikiService.ListPages(projectId) }));

    [HttpPost("search")]
    public async Task<IActionResult> Search([FromRoute] string projectId, [FromBody] CloudWikiSearchRequest request) =>
        await Handle(projectId, async () => Ok(new { results = await cloudWikiService.Search(projectId, request) }));

    [HttpGet("pages/read")]
    public async Task<IActionResult> ReadPage([FromRoute] string projectId, [FromQuery(Name = "path_or_title")] string pathOrTitle) =>
        await Handle(projectId, async () => Ok(await cloudWikiService.ReadPage(projectId, pathOrTitle)));

    [HttpGet("overview")]
    public async Task<IActionResult> Overview([FromRoute] string projectId) =>
        await Handle(projectId, async () => Ok(new { content = await cloudWikiService.GetOverview(projectId) }));

    private async Task<IActionResult> Handle(string projectId, Func<Task<IActionResult>> action)
    {
        if (!cloudWikiService.IsAuthorized(Request.Headers.Authorization))
            return Unauthorized(new { error = "Missing or invalid bearer token" });

        try
        {
            return await action();
        }
        catch (KeyNotFoundException ex)
        {
            return NotFound(new { error = ex.Message, projectId });
        }
        catch (FileNotFoundException ex)
        {
            return NotFound(new { error = ex.Message });
        }
        catch (DirectoryNotFoundException ex)
        {
            return NotFound(new { error = ex.Message, projectId });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }
}
