using LlmWiki.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace LlmWiki.Api.Controllers;

[ApiController]
[Route("api/claude")]
public class ClaudeController(ClaudeCliService claudeCliService) : ControllerBase
{
    [HttpGet("detect")]
    public async Task<IActionResult> Detect() =>
        Ok(await claudeCliService.Detect());
}
