// llm-wiki-server/src/LlmWiki.Api/Modules/Wiki/SseController.cs
using LlmWiki.Api.Infrastructure;
using LlmWiki.Api.Infrastructure.IngestWorker;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Text;
using System.Text.Json;

namespace LlmWiki.Api.Modules.Wiki;

[ApiController]
[Authorize]
public class SseController(
    SseTokenService tokenService,
    IngestEventBroadcaster broadcaster,
    ICurrentUser currentUser,
    AppDbContext db) : ControllerBase
{
    /// <summary>POST /api/departments/{deptId}/events/token</summary>
    [HttpPost("api/departments/{deptId:guid}/events/token")]
    [RequireDeptRole]
    public IActionResult IssueToken(Guid deptId)
    {
        if (!currentUser.IsAuthenticated) return Unauthorized();
        var token = tokenService.Issue(currentUser.UserId, deptId);
        return Ok(new { token, expiresAt = DateTimeOffset.UtcNow.AddMinutes(10) });
    }

    /// <summary>GET /api/departments/{deptId}/events?token=...&amp;lastEventId=...</summary>
    [HttpGet("api/departments/{deptId:guid}/events")]
    [AllowAnonymous] // 鉴权由 token 完成
    public async Task StreamEvents(
        Guid deptId,
        [FromQuery] string token,
        [FromQuery] long lastEventId = 0,
        CancellationToken ct = default)
    {
        var info = tokenService.Validate(token, deptId);
        if (info is null)
        {
            Response.StatusCode = 401;
            return;
        }

        Response.Headers.ContentType = "text/event-stream";
        Response.Headers.CacheControl = "no-cache";
        Response.Headers.Connection = "keep-alive";

        // 断线前的 DB 快照作为初始状态
        var running = await db.IngestTasks
            .Where(t => t.DepartmentId == deptId &&
                        (t.Status == "running" || t.Status == "queued"))
            .Select(t => new { t.Id, t.Status, t.ProgressDetail })
            .ToListAsync(ct);

        foreach (var task in running)
        {
            var snapshot = JsonSerializer.Serialize(new
            {
                taskId = task.Id,
                step = task.Status,
                detail = task.ProgressDetail ?? "",
                isSnapshot = true,
            });
            await WriteEventAsync(0, snapshot, ct);
        }

        await foreach (var evt in broadcaster.SubscribeAsync(deptId, lastEventId, ct))
        {
            var json = JsonSerializer.Serialize(new
            {
                taskId = evt.TaskId,
                step = evt.Step,
                detail = evt.Detail,
                timestamp = evt.Timestamp,
            });
            await WriteEventAsync(evt.Id, json, ct);
        }
    }

    private async Task WriteEventAsync(long id, string data, CancellationToken ct)
    {
        var bytes = Encoding.UTF8.GetBytes($"id: {id}\ndata: {data}\n\n");
        await Response.Body.WriteAsync(bytes, ct);
        await Response.Body.FlushAsync(ct);
    }
}
