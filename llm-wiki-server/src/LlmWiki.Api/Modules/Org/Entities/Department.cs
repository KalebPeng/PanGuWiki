namespace LlmWiki.Api.Modules.Org.Entities;

public class Department
{
    public Guid Id { get; set; }
    public Guid OrgId { get; set; }
    public Organization Org { get; set; } = null!;
    public string Name { get; set; } = "";
    public string Slug { get; set; } = "";        // 组织内唯一
    public string WikiProjectPath { get; set; } = ""; // 文件系统路径
    public string? SettingsJson { get; set; }     // jsonb，部门级配置
    public DateTime CreatedAt { get; set; }
    public ICollection<DepartmentMember> Members { get; set; } = [];
    public ICollection<DepartmentModule> Modules { get; set; } = [];
}
