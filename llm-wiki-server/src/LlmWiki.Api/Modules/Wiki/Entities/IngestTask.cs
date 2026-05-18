namespace LlmWiki.Api.Modules.Wiki.Entities;

public class IngestTask
{
    public Guid Id { get; set; }
    public Guid DepartmentId { get; set; }
    public string SourceFileName { get; set; } = "";    // 文件名，如 报告.xlsx
    public string SourceFilePath { get; set; } = "";    // 相对路径
    public string Status { get; set; } = "queued";     // queued | running | done | failed
    public int? WikiPagesCount { get; set; }
    public Guid? TriggeredBy { get; set; }
    public DateTime QueuedAt { get; set; }
    public DateTime? StartedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
    public string? ErrorMessage { get; set; }
    public string? ProgressDetail { get; set; }  // current step description
    public string? LockedBy { get; set; }  // per-process instance ID during execution
}
