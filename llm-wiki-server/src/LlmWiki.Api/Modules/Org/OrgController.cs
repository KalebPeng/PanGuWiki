using LlmWiki.Api.Infrastructure;
using LlmWiki.Api.Modules.Org.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Text.RegularExpressions;

namespace LlmWiki.Api.Modules.Org;

[ApiController]
[Route("api/orgs")]
[Authorize]
public class OrgController(AppDbContext db, ICurrentUser currentUser) : ControllerBase
{
    // ── Request / Response records ────────────────────────────────────────────

    public record CreateOrgRequest(string Name, string Slug);

    public record OrgResponse(Guid Id, string Name, string Slug, Guid OwnerId, DateTime CreatedAt);

    public record DeptSummaryResponse(Guid Id, Guid OrgId, string Name, string Slug, DateTime CreatedAt);

    public record ErrorResponse(string Error);

    // ── POST /api/orgs ────────────────────────────────────────────────────────

    [HttpPost]
    public async Task<IActionResult> CreateOrg([FromBody] CreateOrgRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
            return BadRequest(new ErrorResponse("Name is required."));

        if (string.IsNullOrWhiteSpace(request.Slug))
            return BadRequest(new ErrorResponse("Slug is required."));

        if (!Regex.IsMatch(request.Slug, @"^[a-z0-9-]+$"))
            return BadRequest(new ErrorResponse("Slug may only contain lowercase letters, digits, and hyphens."));

        var slugLower = request.Slug.ToLowerInvariant();

        var slugExists = await db.Organizations
            .AnyAsync(o => o.Slug.ToLower() == slugLower);

        if (slugExists)
            return Conflict(new ErrorResponse("Slug already taken"));

        var org = new Organization
        {
            Name = request.Name.Trim(),
            Slug = slugLower,
            OwnerId = currentUser.UserId,
            CreatedAt = DateTime.UtcNow,
        };

        db.Organizations.Add(org);
        await db.SaveChangesAsync();

        return CreatedAtAction(
            nameof(GetDepartments),
            new { orgId = org.Id },
            new OrgResponse(org.Id, org.Name, org.Slug, org.OwnerId, org.CreatedAt));
    }

    // ── GET /api/orgs ─────────────────────────────────────────────────────────

    [HttpGet]
    public async Task<IActionResult> ListOrgs()
    {
        var userId = currentUser.UserId;

        var orgs = await db.DepartmentMembers
            .Where(m => m.UserId == userId)
            .Include(m => m.Department)
                .ThenInclude(d => d.Org)
            .Select(m => m.Department.Org)
            .Distinct()
            .OrderBy(o => o.Name)
            .Select(o => new OrgResponse(o.Id, o.Name, o.Slug, o.OwnerId, o.CreatedAt))
            .ToListAsync();

        return Ok(orgs);
    }

    // ── GET /api/orgs/{orgId}/departments ────────────────────────────────────

    [HttpGet("{orgId:guid}/departments")]
    public async Task<IActionResult> GetDepartments(Guid orgId)
    {
        var org = await db.Organizations.FindAsync(orgId);
        if (org is null)
            return NotFound();

        var userId = currentUser.UserId;

        var isMember = await db.DepartmentMembers
            .AnyAsync(m => m.UserId == userId && m.Department.OrgId == orgId);

        if (!isMember)
            return Forbid();

        var departments = await db.Departments
            .Where(d => d.OrgId == orgId)
            .OrderBy(d => d.Name)
            .Select(d => new DeptSummaryResponse(d.Id, d.OrgId, d.Name, d.Slug, d.CreatedAt))
            .ToListAsync();

        return Ok(departments);
    }
}
