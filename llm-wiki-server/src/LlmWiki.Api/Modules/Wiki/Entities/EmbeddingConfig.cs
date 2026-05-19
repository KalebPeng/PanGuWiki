namespace LlmWiki.Api.Modules.Wiki.Entities;

public class EmbeddingConfig
{
    public Guid Id { get; set; }
    public Guid? UserId { get; set; }           // non-null = user-level config
    public Guid? DepartmentId { get; set; }     // non-null = dept-level config (mutually exclusive)
    public string Provider { get; set; } = "";  // "openai" | "openai-compat" | "google"
    public string Endpoint { get; set; } = "";  // API base URL
    public string EncryptedApiKey { get; set; } = "";
    public string Model { get; set; } = "";     // e.g. "text-embedding-3-small"
    public int Dimensions { get; set; } = 1536; // vector size; must match Qdrant collection
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; }
}
