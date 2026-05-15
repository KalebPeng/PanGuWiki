namespace LlmWiki.Api.Modules.Wiki.Entities;

public class LlmConfig
{
    public Guid Id { get; set; }
    public Guid? UserId { get; set; }
    public Guid? DepartmentId { get; set; }
    public string Provider { get; set; } = "";
    public string Endpoint { get; set; } = "";
    public string EncryptedApiKey { get; set; } = "";
    public string Model { get; set; } = "";
    public string? ApiMode { get; set; }
    public int MaxContextSize { get; set; } = 32000;
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; }
}
