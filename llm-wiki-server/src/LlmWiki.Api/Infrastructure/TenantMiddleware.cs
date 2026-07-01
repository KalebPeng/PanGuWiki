using Microsoft.EntityFrameworkCore;

namespace LlmWiki.Api.Infrastructure;

public class TenantMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext ctx, AppDbContext db, ICurrentUser currentUser)
    {
        if (currentUser.IsAuthenticated &&
            ctx.Request.RouteValues.TryGetValue("deptId", out var raw) &&
            Guid.TryParse(raw?.ToString(), out var deptId))
        {
            var member = await db.DepartmentMembers
                .Include(m => m.Department)
                .FirstOrDefaultAsync(
                    m => m.DepartmentId == deptId && m.UserId == currentUser.UserId,
                    ctx.RequestAborted);

            if (member is not null && member.Department is not null)
            {
                var tc = ctx.RequestServices.GetRequiredService<TenantContext>();
                tc.Set(deptId, member.Department.WikiProjectPath, member.Role);
            }
            else
            {
                var superAdminDept = await db.Users
                    .Where(u => u.Id == currentUser.UserId && u.IsSuperAdmin)
                    .SelectMany(_ => db.Departments.Where(d => d.Id == deptId))
                    .FirstOrDefaultAsync(ctx.RequestAborted);

                if (superAdminDept is not null)
                {
                    var tc = ctx.RequestServices.GetRequiredService<TenantContext>();
                    tc.Set(deptId, superAdminDept.WikiProjectPath, "admin");
                }
            }
        }

        await next(ctx);
    }
}
