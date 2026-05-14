using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace LlmWiki.Api.Infrastructure;

[AttributeUsage(AttributeTargets.Method | AttributeTargets.Class)]
public class RequireDeptRoleAttribute(params string[] roles) : Attribute, IAuthorizationFilter
{
    // roles 为空时只检查是否有部门访问权限，不限制角色
    public void OnAuthorization(AuthorizationFilterContext context)
    {
        var tc = context.HttpContext.RequestServices
            .GetService<ITenantContext>();

        if (tc is null || !tc.HasDeptAccess)
        {
            context.Result = new ForbidResult();
            return;
        }

        if (roles.Length > 0 &&
            !roles.Contains(tc.Role ?? "", StringComparer.OrdinalIgnoreCase))
        {
            context.Result = new ForbidResult();
        }
    }
}
