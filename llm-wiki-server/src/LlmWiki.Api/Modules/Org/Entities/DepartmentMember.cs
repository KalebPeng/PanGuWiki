namespace LlmWiki.Api.Modules.Org.Entities;

public class DepartmentMember
{
    public Guid Id { get; set; }
    public Guid DepartmentId { get; set; }
    public Department Department { get; set; } = null!;
    public Guid UserId { get; set; }
    // 不引用 AppUser 导航属性（跨模块），只保留 FK
    public string Role { get; set; } = "viewer"; // admin | editor | viewer
    public DateTime JoinedAt { get; set; }
}
