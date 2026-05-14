using LlmWiki.Api.Modules.Org.Entities;
using Microsoft.EntityFrameworkCore;

namespace LlmWiki.Api.Infrastructure;

public class TenantMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext ctx, AppDbContext db, ICurrentUser currentUser)
    {
        // 仅对已认证用户处理
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
                // 从 DI 容器获取 TenantContext（Scoped），调用内部 Set 方法
                var tc = ctx.RequestServices.GetRequiredService<TenantContext>();
                tc.Set(deptId, member.Department.WikiProjectPath, member.Role);
            }
        }

        await next(ctx);
    }
}
