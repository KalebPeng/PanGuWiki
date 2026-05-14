using LlmWiki.Api.Infrastructure;
using LlmWiki.Api.Modules.Org.Entities;
using LlmWiki.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace LlmWiki.Api.Modules.Org;

[ApiController]
[Authorize]
public class DeptController(AppDbContext db, ICurrentUser currentUser, ProjectService projectService) : ControllerBase
{
    // ── Request / Response records ────────────────────────────────────────────

    public record CreateDeptRequest(string Name, string Slug, string WikiProjectPath);

    public record UpdateDeptRequest(string? Name);

    public record DeptResponse(Guid Id, Guid OrgId, string Name, string Slug, string WikiProjectPath, DateTime CreatedAt);

    public record ErrorResponse(string Error);

    // ── POST /api/orgs/{orgId}/departments ───────────────────────────────────

    [HttpPost("api/orgs/{orgId:guid}/departments")]
    public async Task<IActionResult> CreateDepartment(Guid orgId, [FromBody] CreateDeptRequest request)
    {
        var org = await db.Organizations.FindAsync(orgId);
        if (org is null)
            return NotFound();

        if (org.OwnerId != currentUser.UserId)
            return Forbid();

        if (string.IsNullOrWhiteSpace(request.Name))
            return BadRequest(new ErrorResponse("Name is required."));

        if (string.IsNullOrWhiteSpace(request.Slug))
            return BadRequest(new ErrorResponse("Slug is required."));

        if (string.IsNullOrWhiteSpace(request.WikiProjectPath))
            return BadRequest(new ErrorResponse("WikiProjectPath is required."));

        var slugLower = request.Slug.ToLowerInvariant();

        var slugExists = await db.Departments
            .AnyAsync(d => d.OrgId == orgId && d.Slug.ToLower() == slugLower);

        if (slugExists)
            return Conflict(new ErrorResponse("Slug already taken in this organization"));

        // Initialize wiki project directory first — if this throws, no DB rows are written.
        // Store the returned project root path (basePath/Name), not the raw basePath from
        // the request, so downstream wiki lookups resolve to the correct directory.
        var project = projectService.CreateProject(request.Name.Trim(), request.WikiProjectPath.Trim());

        var dept = new Department
        {
            OrgId = orgId,
            Name = request.Name.Trim(),
            Slug = slugLower,
            WikiProjectPath = project.Path,
            CreatedAt = DateTime.UtcNow,
        };

        db.Departments.Add(dept);

        // Add org owner as admin member of the new department
        var adminMember = new DepartmentMember
        {
            DepartmentId = dept.Id,
            UserId = currentUser.UserId,
            Role = "admin",
            JoinedAt = DateTime.UtcNow,
        };

        db.DepartmentMembers.Add(adminMember);
        await db.SaveChangesAsync();

        return CreatedAtAction(
            nameof(UpdateDepartment),
            new { deptId = dept.Id },
            new DeptResponse(dept.Id, dept.OrgId, dept.Name, dept.Slug, dept.WikiProjectPath, dept.CreatedAt));
    }

    // ── PUT /api/departments/{deptId} ────────────────────────────────────────

    [HttpPut("api/departments/{deptId:guid}")]
    [RequireDeptRole("admin")]
    public async Task<IActionResult> UpdateDepartment(Guid deptId, [FromBody] UpdateDeptRequest request)
    {
        var dept = await db.Departments.FindAsync(deptId);
        if (dept is null)
            return NotFound();

        if (!string.IsNullOrWhiteSpace(request.Name))
            dept.Name = request.Name.Trim();

        await db.SaveChangesAsync();

        return Ok(new DeptResponse(dept.Id, dept.OrgId, dept.Name, dept.Slug, dept.WikiProjectPath, dept.CreatedAt));
    }

    // ── DELETE /api/departments/{deptId} ─────────────────────────────────────

    [HttpDelete("api/departments/{deptId:guid}")]
    [RequireDeptRole("admin")]
    public async Task<IActionResult> DeleteDepartment(Guid deptId)
    {
        var dept = await db.Departments.FindAsync(deptId);
        if (dept is null)
            return NotFound();

        db.Departments.Remove(dept);
        await db.SaveChangesAsync();

        return NoContent();
    }
}
