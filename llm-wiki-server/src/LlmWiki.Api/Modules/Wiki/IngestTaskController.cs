using LlmWiki.Api.Infrastructure;
using LlmWiki.Api.Infrastructure.IngestWorker;
using LlmWiki.Api.Modules.Wiki.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace LlmWiki.Api.Modules.Wiki;

// ── Request / Response records ────────────────────────────────────────────────

public record CreateIngestTaskRequest(string SourceFileName, string SourceFilePath);

public record UpdateIngestTaskRequest(
    string Status,
    int? WikiPagesCount,
    string? ErrorMessage,
    DateTime? StartedAt,
    DateTime? CompletedAt);

public record IngestTaskResponse(
    Guid Id,
    string SourceFileName,
    string SourceFilePath,
    string Status,
    int? WikiPagesCount,
    Guid? TriggeredBy,
    DateTime QueuedAt,
    DateTime? StartedAt,
    DateTime? CompletedAt,
    string? ErrorMessage);

// ── Controller ────────────────────────────────────────────────────────────────

[ApiController]
[Route("api/departments/{deptId:guid}/ingest-tasks")]
[Authorize]
public class IngestTaskController(AppDbContext db, ICurrentUser currentUser, IIngestQueue ingestQueue) : ControllerBase
{
    private static IngestTaskResponse ToResponse(IngestTask t) => new(
        t.Id,
        t.SourceFileName,
        t.SourceFilePath,
        t.Status,
        t.WikiPagesCount,
        t.TriggeredBy,
        t.QueuedAt,
        t.StartedAt,
        t.CompletedAt,
        t.ErrorMessage);

    /// <summary>POST api/departments/{deptId}/ingest-tasks</summary>
    [HttpPost]
    [RequireDeptRole]
    public async Task<IActionResult> Create(Guid deptId, [FromBody] CreateIngestTaskRequest request)
    {
        var task = new IngestTask
        {
            DepartmentId = deptId,
            SourceFileName = request.SourceFileName,
            SourceFilePath = request.SourceFilePath,
            Status = "queued",
            TriggeredBy = currentUser.IsAuthenticated ? currentUser.UserId : null,
            QueuedAt = DateTime.UtcNow,
        };

        db.IngestTasks.Add(task);
        await db.SaveChangesAsync();
        ingestQueue.Signal();

        return CreatedAtAction(nameof(List), new { deptId }, ToResponse(task));
    }

    /// <summary>PATCH api/departments/{deptId}/ingest-tasks/{taskId}</summary>
    [HttpPatch("{taskId:guid}")]
    [RequireDeptRole]
    public async Task<IActionResult> Update(Guid deptId, Guid taskId, [FromBody] UpdateIngestTaskRequest request)
    {
        var task = await db.IngestTasks
            .FirstOrDefaultAsync(t => t.DepartmentId == deptId && t.Id == taskId);

        if (task is null)
            return NotFound();

        task.Status = request.Status;
        if (request.WikiPagesCount is not null) task.WikiPagesCount = request.WikiPagesCount;
        if (request.ErrorMessage is not null) task.ErrorMessage = request.ErrorMessage;
        if (request.StartedAt is not null) task.StartedAt = request.StartedAt;
        if (request.CompletedAt is not null) task.CompletedAt = request.CompletedAt;

        await db.SaveChangesAsync();
        return Ok(ToResponse(task));
    }

    /// <summary>GET api/departments/{deptId}/ingest-tasks[?sourceFileName=xxx]</summary>
    [HttpGet]
    [RequireDeptRole]
    public async Task<IActionResult> List(Guid deptId, [FromQuery] string? sourceFileName = null)
    {
        var query = db.IngestTasks.Where(t => t.DepartmentId == deptId);

        if (!string.IsNullOrWhiteSpace(sourceFileName))
            query = query.Where(t => t.SourceFileName == sourceFileName);

        var tasks = await query
            .OrderByDescending(t => t.QueuedAt)
            .Select(t => ToResponse(t))
            .ToListAsync();

        return Ok(tasks);
    }
}
