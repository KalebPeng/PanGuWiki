using LlmWiki.Api.Models;
using LlmWiki.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace LlmWiki.Api.Controllers;

[ApiController]
[Route("api/project")]
public class ProjectController(ProjectService projectService, ILogger<ProjectController> logger) : ControllerBase
{
    [HttpPost("create")]
    public IActionResult Create([FromBody] CreateProjectRequest req)
    {
        logger.LogInformation("Received create-project request. Name={ProjectName} Path={BasePath}", req.Name, req.Path);
        try
        {
            var project = projectService.CreateProject(req.Name, req.Path);
            logger.LogInformation("Create-project succeeded. Name={ProjectName} ProjectPath={ProjectPath}", project.Name, project.Path);
            return Ok(project);
        }
        catch (InvalidOperationException ex)
        {
            logger.LogWarning(ex, "Create-project rejected. Name={ProjectName} Path={BasePath}", req.Name, req.Path);
            return BadRequest(new { error = ex.Message });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Create-project failed. Name={ProjectName} Path={BasePath}", req.Name, req.Path);
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
