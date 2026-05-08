using LlmWiki.Api.Models;
using LlmWiki.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace LlmWiki.Api.Controllers;

[ApiController]
[Route("api/project")]
public class ProjectController(ProjectService projectService) : ControllerBase
{
    [HttpPost("create")]
    public IActionResult Create([FromBody] CreateProjectRequest req)
    {
        try
        {
            var project = projectService.CreateProject(req.Name, req.Path);
            return Ok(project);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { error = $"File system error: {ex.Message}" });
        }
    }

    [HttpPost("open")]
    public IActionResult Open([FromBody] OpenProjectRequest req)
    {
        try
        {
            var project = projectService.OpenProject(req.Path);
            return Ok(project);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { error = $"File system error: {ex.Message}" });
        }
    }
}
