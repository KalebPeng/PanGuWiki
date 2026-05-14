namespace LlmWiki.Api.Infrastructure;

public interface ITenantContext
{
    Guid? DepartmentId { get; }
    string? WikiProjectPath { get; }
    string? Role { get; }
    bool HasDeptAccess { get; }
}
