namespace LlmWiki.Api.Modules.Org.Entities;

public class DepartmentModule
{
    public Guid DepartmentId { get; set; }
    public Department Department { get; set; } = null!;
    public string ModuleKey { get; set; } = "";  // wiki | project_mgmt | ...
    public bool IsEnabled { get; set; } = true;
    public string? ConfigJson { get; set; }
}
