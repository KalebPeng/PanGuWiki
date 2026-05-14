namespace LlmWiki.Api.Modules.Org.Entities;

public class Organization
{
    public Guid Id { get; set; }
    public string Name { get; set; } = "";
    public string Slug { get; set; } = "";       // URL 友好标识，全局唯一
    public Guid OwnerId { get; set; }             // FK → AppUser.Id
    public DateTime CreatedAt { get; set; }
    public ICollection<Department> Departments { get; set; } = [];
}
