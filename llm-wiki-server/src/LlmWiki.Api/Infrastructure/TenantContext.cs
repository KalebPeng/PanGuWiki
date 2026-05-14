namespace LlmWiki.Api.Infrastructure;

// Scoped service — set by TenantMiddleware (Phase 2), read via ITenantContext
public class TenantContext : ITenantContext
{
    public Guid? DepartmentId { get; private set; }
    public string? WikiProjectPath { get; private set; }
    public string? Role { get; private set; }
    public bool HasDeptAccess => DepartmentId.HasValue;

    internal void Set(Guid departmentId, string wikiProjectPath, string role)
    {
        DepartmentId = departmentId;
        WikiProjectPath = wikiProjectPath;
        Role = role;
    }
}
