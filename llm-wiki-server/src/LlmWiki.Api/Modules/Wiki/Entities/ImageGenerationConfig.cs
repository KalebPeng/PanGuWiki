namespace LlmWiki.Api.Modules.Wiki.Entities;

public class ImageGenerationConfig
{
    public Guid Id { get; set; }
    public Guid DepartmentId { get; set; }
    public string BaseUrl { get; set; } = "";
    public string EncryptedApiKey { get; set; } = "";
    public string Model { get; set; } = "";
    public string DefaultSize { get; set; } = "1024x1024";
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
