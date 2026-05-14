using LlmWiki.Api.Infrastructure;
using LlmWiki.Api.Modules.Identity.Entities;
using LlmWiki.Api.Modules.Org.Entities;
using LlmWiki.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using System.Text.RegularExpressions;

namespace LlmWiki.Api.Modules.Admin;

[ApiController]
[Route("api/admin")]
[Authorize]
[RequireSuperAdmin]
public class AdminController(
    AppDbContext db,
    ProjectService projectService,
    IOptions<WikiProjectsOptions> wikiOptions) : ControllerBase
{
    // ── Records ───────────────────────────────────────────────────────────────

    public record AdminUserResponse(
        Guid Id, string Email, string DisplayName,
        bool IsActive, bool IsSuperAdmin, DateTime CreatedAt);

    public record PatchUserRequest(bool? IsActive, bool? IsSuperAdmin);

    public record AdminOrgResponse(
        Guid Id, string Name, string Slug, Guid OwnerId, int DeptCount, DateTime CreatedAt);

    public record CreateOrgRequest(string Name, string Slug, string OwnerEmail);

    public record AdminDeptResponse(
        Guid Id, Guid OrgId, string Name, string Slug,
        string WikiProjectPath, int MemberCount, DateTime CreatedAt);

    // wiki_project_path 可选：留空则基于 WikiProjects:RootPath 自动生成
    public record CreateDeptRequest(string Name, string Slug, string? WikiProjectPath);

    public record AdminMemberResponse(
        Guid Id, Guid UserId, string Email, string DisplayName, string Role, DateTime JoinedAt);

    public record AddMemberRequest(string Email, string Role);

    public record UpdateRoleRequest(string Role);

    public record ErrorResponse(string Error);

    // ── 用户管理 ──────────────────────────────────────────────────────────────

    [HttpGet("users")]
    public async Task<IActionResult> GetUsers()
    {
        var users = await db.Users
            .OrderBy(u => u.CreatedAt)
            .Select(u => new AdminUserResponse(
                u.Id, u.Email, u.DisplayName,
                u.IsActive, u.IsSuperAdmin, u.CreatedAt))
            .ToListAsync();
        return Ok(users);
    }

    [HttpPatch("users/{userId:guid}")]
    public async Task<IActionResult> PatchUser(Guid userId, [FromBody] PatchUserRequest request)
    {
        var user = await db.Users.FindAsync(userId);
        if (user is null) return NotFound(new ErrorResponse("User not found"));

        if (request.IsActive.HasValue) user.IsActive = request.IsActive.Value;
        if (request.IsSuperAdmin.HasValue) user.IsSuperAdmin = request.IsSuperAdmin.Value;
        user.UpdatedAt = DateTime.UtcNow;

        await db.SaveChangesAsync();
        return Ok(new AdminUserResponse(
            user.Id, user.Email, user.DisplayName,
            user.IsActive, user.IsSuperAdmin, user.CreatedAt));
    }

    // ── 组织管理 ──────────────────────────────────────────────────────────────

    [HttpGet("orgs")]
    public async Task<IActionResult> GetOrgs()
    {
        var orgList = await db.Organizations.OrderBy(o => o.Name).ToListAsync();
        var deptCounts = await db.Departments
            .GroupBy(d => d.OrgId)
            .Select(g => new { OrgId = g.Key, Count = g.Count() })
            .ToListAsync();
        var countMap = deptCounts.ToDictionary(x => x.OrgId, x => x.Count);
        var orgs = orgList.Select(o => new AdminOrgResponse(
            o.Id, o.Name, o.Slug, o.OwnerId,
            countMap.GetValueOrDefault(o.Id, 0),
            o.CreatedAt)).ToList();
        return Ok(orgs);
    }

    [HttpPost("orgs")]
    public async Task<IActionResult> CreateOrg([FromBody] CreateOrgRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Name) ||
            string.IsNullOrWhiteSpace(request.Slug) ||
            string.IsNullOrWhiteSpace(request.OwnerEmail))
            return BadRequest(new ErrorResponse("Name, slug and owner_email are required"));

        if (!Regex.IsMatch(request.Slug, @"^[a-z0-9-]+$"))
            return BadRequest(new ErrorResponse("Slug may only contain lowercase letters, numbers and hyphens"));

        var slugLower = request.Slug.ToLowerInvariant();
        if (await db.Organizations.AnyAsync(o => o.Slug == slugLower))
            return Conflict(new ErrorResponse("Slug already taken"));

        var owner = await db.Users.FirstOrDefaultAsync(u => u.Email == request.OwnerEmail.ToLowerInvariant());
        if (owner is null) return NotFound(new ErrorResponse("Owner user not found"));

        var org = new Organization
        {
            Id = Guid.NewGuid(),
            Name = request.Name,
            Slug = slugLower,
            OwnerId = owner.Id,
            CreatedAt = DateTime.UtcNow,
        };
        db.Organizations.Add(org);
        await db.SaveChangesAsync();

        return CreatedAtAction(nameof(GetOrgs), null,
            new AdminOrgResponse(org.Id, org.Name, org.Slug, org.OwnerId, 0, org.CreatedAt));
    }

    [HttpDelete("orgs/{orgId:guid}")]
    public async Task<IActionResult> DeleteOrg(Guid orgId)
    {
        var org = await db.Organizations.FindAsync(orgId);
        if (org is null) return NotFound(new ErrorResponse("Organization not found"));
        db.Organizations.Remove(org);
        await db.SaveChangesAsync();
        return NoContent();
    }

    // ── 部门管理 ──────────────────────────────────────────────────────────────

    [HttpGet("orgs/{orgId:guid}/departments")]
    public async Task<IActionResult> GetDepts(Guid orgId)
    {
        if (!await db.Organizations.AnyAsync(o => o.Id == orgId))
            return NotFound(new ErrorResponse("Organization not found"));

        var deptList = await db.Departments
            .Where(d => d.OrgId == orgId)
            .OrderBy(d => d.Name)
            .ToListAsync();
        var deptIds = deptList.Select(d => d.Id).ToList();
        var memberCounts = await db.DepartmentMembers
            .Where(m => deptIds.Contains(m.DepartmentId))
            .GroupBy(m => m.DepartmentId)
            .Select(g => new { DeptId = g.Key, Count = g.Count() })
            .ToListAsync();
        var memberCountMap = memberCounts.ToDictionary(x => x.DeptId, x => x.Count);
        var depts = deptList.Select(d => new AdminDeptResponse(
            d.Id, d.OrgId, d.Name, d.Slug,
            d.WikiProjectPath,
            memberCountMap.GetValueOrDefault(d.Id, 0),
            d.CreatedAt)).ToList();
        return Ok(depts);
    }

    [HttpPost("orgs/{orgId:guid}/departments")]
    public async Task<IActionResult> CreateDept(Guid orgId, [FromBody] CreateDeptRequest request)
    {
        if (!await db.Organizations.AnyAsync(o => o.Id == orgId))
            return NotFound(new ErrorResponse("Organization not found"));

        if (string.IsNullOrWhiteSpace(request.Name) ||
            string.IsNullOrWhiteSpace(request.Slug))
            return BadRequest(new ErrorResponse("Name and slug are required"));

        var slugLower = request.Slug.ToLowerInvariant();
        if (await db.Departments.AnyAsync(d => d.OrgId == orgId && d.Slug == slugLower))
            return Conflict(new ErrorResponse("Slug already used in this organization"));

        // 路径：前端填了则用前端的，否则基于 WikiProjects:RootPath 自动生成
        var rootPath = string.IsNullOrWhiteSpace(request.WikiProjectPath)
            ? (wikiOptions.Value.RootPath ?? "/data/wiki")
            : request.WikiProjectPath;

        LlmWiki.Api.Models.WikiProject project;
        try
        {
            project = projectService.CreateProject(request.Name, rootPath);
        }
        catch (Exception ex)
        {
            return BadRequest(new ErrorResponse($"无法创建 Wiki 目录：{ex.Message}。请检查路径是否正确，或手动填写可访问的路径。"));
        }

        var dept = new Department
        {
            Id = Guid.NewGuid(),
            OrgId = orgId,
            Name = request.Name,
            Slug = slugLower,
            WikiProjectPath = project.Path,
            CreatedAt = DateTime.UtcNow,
        };
        db.Departments.Add(dept);
        await db.SaveChangesAsync();

        return CreatedAtAction(nameof(GetDepts), new { orgId },
            new AdminDeptResponse(dept.Id, dept.OrgId, dept.Name, dept.Slug,
                dept.WikiProjectPath, 0, dept.CreatedAt));
    }

    [HttpDelete("departments/{deptId:guid}")]
    public async Task<IActionResult> DeleteDept(Guid deptId)
    {
        var dept = await db.Departments.FindAsync(deptId);
        if (dept is null) return NotFound(new ErrorResponse("Department not found"));
        db.Departments.Remove(dept);
        await db.SaveChangesAsync();
        return NoContent();
    }

    // ── 成员管理 ──────────────────────────────────────────────────────────────

    [HttpGet("departments/{deptId:guid}/members")]
    public async Task<IActionResult> GetMembers(Guid deptId)
    {
        if (!await db.Departments.AnyAsync(d => d.Id == deptId))
            return NotFound(new ErrorResponse("Department not found"));

        var members = await db.DepartmentMembers
            .Where(m => m.DepartmentId == deptId)
            .Join(db.Users, m => m.UserId, u => u.Id,
                (m, u) => new AdminMemberResponse(
                    m.Id, m.UserId, u.Email, u.DisplayName, m.Role, m.JoinedAt))
            .ToListAsync();
        return Ok(members);
    }

    [HttpPost("departments/{deptId:guid}/members")]
    public async Task<IActionResult> AddMember(Guid deptId, [FromBody] AddMemberRequest request)
    {
        if (!await db.Departments.AnyAsync(d => d.Id == deptId))
            return NotFound(new ErrorResponse("Department not found"));

        var user = await db.Users.FirstOrDefaultAsync(u => u.Email == request.Email.ToLowerInvariant());
        if (user is null) return NotFound(new ErrorResponse("User not found"));

        if (await db.DepartmentMembers.AnyAsync(m => m.DepartmentId == deptId && m.UserId == user.Id))
            return Conflict(new ErrorResponse("Already a member"));

        var member = new DepartmentMember
        {
            Id = Guid.NewGuid(),
            DepartmentId = deptId,
            UserId = user.Id,
            Role = request.Role,
            JoinedAt = DateTime.UtcNow,
        };
        db.DepartmentMembers.Add(member);
        await db.SaveChangesAsync();

        return CreatedAtAction(nameof(GetMembers), new { deptId },
            new AdminMemberResponse(member.Id, member.UserId, user.Email, user.DisplayName, member.Role, member.JoinedAt));
    }

    [HttpPut("departments/{deptId:guid}/members/{userId:guid}")]
    public async Task<IActionResult> UpdateMemberRole(Guid deptId, Guid userId, [FromBody] UpdateRoleRequest request)
    {
        var member = await db.DepartmentMembers
            .FirstOrDefaultAsync(m => m.DepartmentId == deptId && m.UserId == userId);
        if (member is null) return NotFound(new ErrorResponse("Member not found"));

        member.Role = request.Role;
        await db.SaveChangesAsync();

        var user = await db.Users.FindAsync(userId);
        return Ok(new AdminMemberResponse(
            member.Id, member.UserId,
            user?.Email ?? "", user?.DisplayName ?? "",
            member.Role, member.JoinedAt));
    }

    [HttpDelete("departments/{deptId:guid}/members/{userId:guid}")]
    public async Task<IActionResult> RemoveMember(Guid deptId, Guid userId)
    {
        var member = await db.DepartmentMembers
            .FirstOrDefaultAsync(m => m.DepartmentId == deptId && m.UserId == userId);
        if (member is null) return NotFound(new ErrorResponse("Member not found"));

        db.DepartmentMembers.Remove(member);
        await db.SaveChangesAsync();
        return NoContent();
    }
}
