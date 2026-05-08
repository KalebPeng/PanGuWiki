using LlmWiki.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace LlmWiki.Api.Controllers;

[ApiController]
[Route("api/proxy")]
public class ProxyController(ProxyService proxyService) : ControllerBase
{
    [HttpPost("set")]
    public IActionResult Set([FromBody] ProxyConfig config)
    {
        var summary = proxyService.ApplyProxy(config);
        return Ok(new { summary });
    }
}
