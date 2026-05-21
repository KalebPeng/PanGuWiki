using LlmWiki.Api.Infrastructure;
using LlmWiki.Api.Modules.Org.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace LlmWiki.Api.Modules.Org;

[ApiController]
[Route("api/departments/{deptId:guid}/members")]
[Authorize]
public class DeptMemberController(AppDbContext db) : ControllerBase
{
    private static readonly HashSet<string> AllowedRoles =
        new(StringComparer.OrdinalIgnoreCase) { "admin", "editor", "viewer" };

    // ── Request / Response records ────────────────────────────────────────────

    public record AddMemberRequest(string Email, string Role);

    public record UpdateMemberRoleRequest(string Role);

    public record MemberResponse(Guid Id, Guid UserId, string Email, string DisplayName, string Role, DateTime JoinedAt);

    public record ErrorResponse(string Error);

    // ── GET /api/departments/{deptId}/members ────────────────────────────────

    [HttpGet]
    [RequireDeptRole]
    public async Task<IActionResult> ListMembers(Guid deptId)
    {
        var members = await db.DepartmentMembers
            .Where(m => m.DepartmentId == deptId)
            .OrderBy(m => m.JoinedAt)
            .Join(db.Users,
                m => m.UserId,
                u => u.Id,
                (m, u) => new MemberResponse(m.Id, m.UserId, u.Email, u.DisplayName, m.Role, m.JoinedAt))
            .ToListAsync();

        return Ok(members);
    }

    // ── POST /api/departments/{deptId}/members ───────────────────────────────

    [HttpPost]
    [RequireDeptRole("admin")]
    public async Task<IActionResult> AddMember(Guid deptId, [FromBody] AddMemberRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Email))
            return BadRequest(new ErrorResponse("Email is required."));

        if (!AllowedRoles.Contains(request.Role))
            return BadRequest(new ErrorResponse("Role must be one of: admin, editor, viewer."));

        var emailLower = request.Email.Trim().ToLowerInvariant();

        var user = await db.Users
            .FirstOrDefaultAsync(u => u.Email == emailLower);

        if (user is null)
            return NotFound(new ErrorResponse("User not found"));

        var alreadyMember = await db.DepartmentMembers
            .AnyAsync(m => m.DepartmentId == deptId && m.UserId == user.Id);

        if (alreadyMember)
            return Conflict(new ErrorResponse("Already a member"));

        var member = new DepartmentMember
        {
            DepartmentId = deptId,
            UserId = user.Id,
            Role = request.Role.ToLowerInvariant(),
            JoinedAt = DateTime.UtcNow,
        };

        db.DepartmentMembers.Add(member);
        await db.SaveChangesAsync();

        return CreatedAtAction(
            nameof(ListMembers),
            new { deptId },
            new MemberResponse(member.Id, member.UserId, user.Email, user.DisplayName, member.Role, member.JoinedAt));
    }

    // ── PUT /api/departments/{deptId}/members/{userId} ───────────────────────

    [HttpPut("{userId:guid}")]
    [RequireDeptRole("admin")]
    public async Task<IActionResult> UpdateMemberRole(Guid deptId, Guid userId, [FromBody] UpdateMemberRoleRequest request)
    {
        if (!AllowedRoles.Contains(request.Role))
            return BadRequest(new ErrorResponse("Role must be one of: admin, editor, viewer."));

        var member = await db.DepartmentMembers
            .FirstOrDefaultAsync(m => m.DepartmentId == deptId && m.UserId == userId);

        if (member is null)
            return NotFound();

        member.Role = request.Role.ToLowerInvariant();
        await db.SaveChangesAsync();

        var user = await db.Users.FindAsync(member.UserId);
        return Ok(new MemberResponse(member.Id, member.UserId,
            user?.Email ?? "", user?.DisplayName ?? "",
            member.Role, member.JoinedAt));
    }

    // ── DELETE /api/departments/{deptId}/members/{userId} ───────────────────

    [HttpDelete("{userId:guid}")]
    [RequireDeptRole("admin")]
    public async Task<IActionResult> RemoveMember(Guid deptId, Guid userId)
    {
        var member = await db.DepartmentMembers
            .FirstOrDefaultAsync(m => m.DepartmentId == deptId && m.UserId == userId);

        if (member is null)
            return NotFound();

        // 使用事务防止并发删除最后一个 admin
        await using var tx = await db.Database.BeginTransactionAsync(
            System.Data.IsolationLevel.RepeatableRead, HttpContext.RequestAborted);

        var adminCount = await db.DepartmentMembers
            .CountAsync(m => m.DepartmentId == deptId && m.Role.ToLower() == "admin",
                HttpContext.RequestAborted);

        if (adminCount <= 1 && string.Equals(member.Role, "admin", StringComparison.OrdinalIgnoreCase))
            return BadRequest(new ErrorResponse("Cannot remove the last admin"));

        db.DepartmentMembers.Remove(member);
        await db.SaveChangesAsync(HttpContext.RequestAborted);
        await tx.CommitAsync(HttpContext.RequestAborted);

        return NoContent();
    }
}
