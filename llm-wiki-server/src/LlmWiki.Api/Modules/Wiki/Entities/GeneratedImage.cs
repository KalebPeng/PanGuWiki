namespace LlmWiki.Api.Modules.Wiki.Entities;

public class GeneratedImage
{
    public Guid Id { get; set; }
    public Guid DepartmentId { get; set; }
    public Guid UserId { get; set; }
    public string Prompt { get; set; } = "";
    public string Model { get; set; } = "";
    public string Size { get; set; } = "";
    public string FilePath { get; set; } = "";
    public string MimeType { get; set; } = "image/png";
    public string? SourceUrl { get; set; }
    public DateTime CreatedAt { get; set; }
}
