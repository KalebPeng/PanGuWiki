using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using LlmWiki.Api.Infrastructure.LlmClient;
using LlmWiki.Api.Modules.Wiki.Entities;
using LlmWiki.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace LlmWiki.Api.Infrastructure.IngestWorker;

public record ParsedFileBlock(string Path, string Content);
public record ParseFileBlocksResult(IReadOnlyList<ParsedFileBlock> Blocks, IReadOnlyList<string> Warnings);

public class IngestPipelineService(
    ILlmClient llmClient,
    FileService fileService,
    LlmConfigService llmConfigService,
    IngestEventBroadcaster broadcaster,
    AppDbContext db)
{
    private static readonly Regex OpenerLine =
        new(@"^---\s*FILE:\s*(.+?)\s*---\s*$", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex CloserLine =
        new(@"^---\s*END\s+FILE\s*---\s*$", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex FenceLine =
        new(@"^\s{0,3}(```+|~~~+)", RegexOptions.Compiled);

    public static ParseFileBlocksResult ParseFileBlocks(string text)
    {
        var normalized = text.Replace("\r\n", "\n");
        var lines = normalized.Split('\n');
        var blocks = new List<ParsedFileBlock>();
        var warnings = new List<string>();
        int i = 0;

        while (i < lines.Length)
        {
            var openerMatch = OpenerLine.Match(lines[i]);
            if (!openerMatch.Success) { i++; continue; }

            var path = openerMatch.Groups[1].Value.Trim();
            i++;

            var contentLines = new List<string>();
            string? fenceMarker = null;
            int fenceLen = 0;
            bool closed = false;

            while (i < lines.Length)
            {
                var line = lines[i];
                var fenceMatch = FenceLine.Match(line);
                if (fenceMatch.Success)
                {
                    var run = fenceMatch.Groups[1].Value;
                    var ch = run[0]; var len = run.Length;
                    if (fenceMarker == null) { fenceMarker = ch.ToString(); fenceLen = len; }
                    else if (ch.ToString() == fenceMarker && len >= fenceLen) { fenceMarker = null; fenceLen = 0; }
                    contentLines.Add(line); i++; continue;
                }

                if (fenceMarker == null && CloserLine.IsMatch(line))
                { closed = true; i++; break; }

                contentLines.Add(line); i++;
            }

            if (!closed)
            {
                var msg = $"FILE block \"{(string.IsNullOrEmpty(path) ? "(unnamed)" : path)}\" not closed — likely stream truncation.";
                warnings.Add(msg); continue;
            }
            if (string.IsNullOrWhiteSpace(path))
            {
                warnings.Add("FILE block with empty path skipped."); continue;
            }
            if (!IsSafePath(path))
            {
                warnings.Add($"FILE block with unsafe path \"{path}\" rejected."); continue;
            }

            blocks.Add(new ParsedFileBlock(path, string.Join("\n", contentLines)));
        }

        return new ParseFileBlocksResult(blocks, warnings);
    }

    private static bool IsSafePath(string p)
    {
        if (string.IsNullOrWhiteSpace(p)) return false;
        if (p.Contains('\x00')) return false;
        if (p.StartsWith('/') || p.StartsWith('\\')) return false;
        if (Regex.IsMatch(p, @"^[a-zA-Z]:")) return false;
        var norm = p.Replace('\\', '/');
        if (norm.Split('/').Any(s => s == ".." || s == ".")) return false;
        if (!norm.StartsWith("wiki/")) return false;
        return true;
    }

    public async Task RunAsync(IngestTask task, CancellationToken ct)
    {
        // 原子标记为 running（幂等保护）
        var updated = await db.IngestTasks
            .Where(t => t.Id == task.Id && t.Status == "queued")
            .ExecuteUpdateAsync(s => s
                .SetProperty(t => t.Status, "running")
                .SetProperty(t => t.StartedAt, DateTime.UtcNow), ct);
        if (updated == 0) return; // 已被其他路径处理

        var deptId = task.DepartmentId;

        async Task UpdateProgress(string step, string detail)
        {
            await db.IngestTasks
                .Where(t => t.Id == task.Id)
                .ExecuteUpdateAsync(s => s.SetProperty(t => t.ProgressDetail, detail), ct);
            broadcaster.Publish(deptId, broadcaster.CreateEvent(task.Id, step, detail));
        }

        try
        {
            // 解析 LlmConfig（TriggeredBy 用户级 → 部门级）
            LlmConfig? config = null;
            if (task.TriggeredBy.HasValue)
                config = await db.LlmConfigs
                    .Where(c => c.UserId == task.TriggeredBy && c.IsActive)
                    .FirstOrDefaultAsync(ct);
            config ??= await db.LlmConfigs
                .Where(c => c.DepartmentId == deptId && c.IsActive)
                .FirstOrDefaultAsync(ct);

            if (config is null)
                throw new InvalidOperationException("LLM not configured for this user or department");

            // 解密 API Key（LlmConfig 是 class，需要手动复制）
            var runtimeConfig = new LlmConfig
            {
                Id = config.Id,
                UserId = config.UserId,
                DepartmentId = config.DepartmentId,
                Provider = config.Provider,
                Endpoint = config.Endpoint,
                EncryptedApiKey = llmConfigService.DecryptIfNotEmpty(config.EncryptedApiKey),
                Model = config.Model,
                ApiMode = config.ApiMode,
                MaxContextSize = config.MaxContextSize,
                IsActive = config.IsActive,
                CreatedAt = config.CreatedAt,
            };

            // 读取源文件 + 项目元文件
            await UpdateProgress("reading", "Reading source file...");
            var sourcePath = task.SourceFilePath;
            var sourceContent = await TryReadFileAsync(sourcePath);
            var projectRoot = GetProjectRoot(sourcePath);

            var (purpose, index, schema, overview) = await ReadMetaFilesAsync(projectRoot, ct);

            // 检查 ingest cache
            var cacheHit = await CheckIngestCacheAsync(projectRoot, task.SourceFileName, sourceContent);
            if (cacheHit is not null)
            {
                await MarkDone(task.Id, cacheHit.Count, "Skipped (cached)", ct);
                broadcaster.Publish(deptId, broadcaster.CreateEvent(task.Id, "done",
                    $"Skipped (unchanged) — {cacheHit.Count} cached files"));
                return;
            }

            // 截断源内容
            var maxChars = runtimeConfig.MaxContextSize * 3;
            var truncated = sourceContent.Length > maxChars
                ? sourceContent[..maxChars] + "\n\n[...truncated...]"
                : sourceContent;

            // Step 1: 分析
            await UpdateProgress("analyzing", "Step 1/2: Analyzing source...");
            var analysis = new StringBuilder();
            var analysisMessages = new[]
            {
                new ChatMessage("system", BuildAnalysisPrompt(purpose, index, truncated)),
                new ChatMessage("user", $"Analyze this source document:\n\n**File:** {task.SourceFileName}\n\n---\n\n{truncated}"),
            };
            await foreach (var token in llmClient.StreamChatAsync(
                runtimeConfig, analysisMessages, new LlmOptions(0.1f, 4096), ct))
                analysis.Append(token);

            // Step 2: 生成
            await UpdateProgress("generating", "Step 2/2: Generating wiki pages...");
            var generation = new StringBuilder();
            var genMessages = new[]
            {
                new ChatMessage("system", BuildGenerationPrompt(schema, purpose, index, task.SourceFileName, overview, truncated)),
                new ChatMessage("user", string.Join("\n", [
                    $"Source document to process: **{task.SourceFileName}**",
                    "",
                    "The Stage 1 analysis below is CONTEXT only. Do NOT echo it. Your output must be FILE blocks as specified.",
                    "",
                    "## Stage 1 Analysis (context only — do not repeat)",
                    "",
                    analysis.ToString(),
                    "",
                    "## Original Source Content",
                    "",
                    truncated,
                    "",
                    "---",
                    "",
                    $"Now emit the FILE blocks for the wiki files derived from **{task.SourceFileName}**.",
                    "Your response MUST begin with `---FILE:` as the very first characters.",
                ])),
            };
            await foreach (var token in llmClient.StreamChatAsync(
                runtimeConfig, genMessages, new LlmOptions(0.1f, 8192), ct))
                generation.Append(token);

            // 解析 + 写文件
            await UpdateProgress("writing", "Writing files...");
            var parseResult = ParseFileBlocks(generation.ToString());
            var writtenPaths = new List<string>();

            foreach (var block in parseResult.Blocks)
            {
                var fullPath = Path.Combine(projectRoot, block.Path.Replace('/', Path.DirectorySeparatorChar));
                await WriteWikiFileAsync(fullPath, block.Path, block.Content, task.SourceFileName);
                writtenPaths.Add(block.Path);
            }

            // 保证 source summary 页存在
            var sourceBaseName = Path.GetFileNameWithoutExtension(task.SourceFileName);
            var sourceSummaryPath = $"wiki/sources/{sourceBaseName}.md";
            if (!writtenPaths.Any(p => p.StartsWith("wiki/sources/")))
            {
                var date = DateTime.UtcNow.ToString("yyyy-MM-dd");
                var fallback = $"---\ntype: source\ntitle: \"Source: {task.SourceFileName}\"\ncreated: {date}\nupdated: {date}\nsources: [\"{task.SourceFileName}\"]\ntags: []\nrelated: []\n---\n\n# Source: {task.SourceFileName}\n\n{analysis.ToString()[..Math.Min(3000, analysis.Length)]}\n";
                await WriteRawFileAsync(Path.Combine(projectRoot, sourceSummaryPath.Replace('/', Path.DirectorySeparatorChar)), fallback);
                writtenPaths.Add(sourceSummaryPath);
            }

            // 写 ingest cache（仅在有文件写出后）
            if (writtenPaths.Count > 0)
                await SaveIngestCacheAsync(projectRoot, task.SourceFileName, sourceContent, writtenPaths);

            await MarkDone(task.Id, writtenPaths.Count,
                $"{writtenPaths.Count} files written", ct);
            broadcaster.Publish(deptId, broadcaster.CreateEvent(task.Id, "done",
                $"{writtenPaths.Count} files written"));
        }
        catch (Exception ex) when (!ct.IsCancellationRequested)
        {
            var msg = ex.Message.Length > 500 ? ex.Message[..500] : ex.Message;
            await db.IngestTasks
                .Where(t => t.Id == task.Id)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(t => t.Status, "failed")
                    .SetProperty(t => t.ErrorMessage, msg)
                    .SetProperty(t => t.CompletedAt, DateTime.UtcNow), ct);
            broadcaster.Publish(deptId, broadcaster.CreateEvent(task.Id, "failed", msg));
            throw;
        }
    }

    private async Task MarkDone(Guid taskId, int pageCount, string detail, CancellationToken ct) =>
        await db.IngestTasks
            .Where(t => t.Id == taskId)
            .ExecuteUpdateAsync(s => s
                .SetProperty(t => t.Status, "done")
                .SetProperty(t => t.WikiPagesCount, pageCount)
                .SetProperty(t => t.ProgressDetail, detail)
                .SetProperty(t => t.CompletedAt, DateTime.UtcNow), ct);

    // ── File I/O helpers ──────────────────────────────────────────────────

    private static string GetProjectRoot(string sourcePath)
    {
        var dir = Path.GetDirectoryName(Path.GetFullPath(sourcePath)) ?? "";
        while (!string.IsNullOrEmpty(dir))
        {
            if (Directory.Exists(Path.Combine(dir, "wiki"))) return dir;
            dir = Path.GetDirectoryName(dir) ?? "";
        }
        return Path.GetDirectoryName(Path.GetFullPath(sourcePath)) ?? "";
    }

    private async Task<string> TryReadFileAsync(string path)
    {
        try { return await fileService.ReadFile(path); }
        catch { return ""; }
    }

    private async Task<(string purpose, string index, string schema, string overview)>
        ReadMetaFilesAsync(string root, CancellationToken ct)
    {
        async Task<string> TryRead(string rel)
        {
            try { return await fileService.ReadFile(Path.Combine(root, rel)); }
            catch { return ""; }
        }
        var results = await Task.WhenAll(
            TryRead("purpose.md"), TryRead("wiki/index.md"),
            TryRead("schema.md"), TryRead("wiki/overview.md"));
        return (results[0], results[1], results[2], results[3]);
    }

    private async Task WriteWikiFileAsync(
        string fullPath, string relativePath, string content, string sourceFileName)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(fullPath)!);

        if (relativePath == "wiki/log.md")
        {
            await WriteLogEntryAsync(fullPath, content, sourceFileName);
            return;
        }
        await File.WriteAllTextAsync(fullPath, content);
    }

    private static async Task WriteLogEntryAsync(string fullPath, string newEntry, string sourceFileName)
    {
        var existing = File.Exists(fullPath) ? await File.ReadAllTextAsync(fullPath) : "";
        var sourceTag = sourceFileName.Replace("[", "").Replace("]", "");
        var pattern = new Regex($@"##\s*\[.*?\].*{Regex.Escape(sourceTag)}.*(\n(?!##).*)*",
            RegexOptions.IgnoreCase);
        var updated = pattern.IsMatch(existing)
            ? pattern.Replace(existing, newEntry.Trim() + "\n\n", 1)
            : (string.IsNullOrEmpty(existing) ? newEntry : existing.TrimEnd() + "\n\n" + newEntry);
        await File.WriteAllTextAsync(fullPath, updated);
    }

    private static Task WriteRawFileAsync(string fullPath, string content)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(fullPath)!);
        return File.WriteAllTextAsync(fullPath, content);
    }

    // ── Ingest cache ──────────────────────────────────────────────────────

    private record CacheEntry(string Hash, long Timestamp, List<string> FilesWritten);
    private record CacheData(Dictionary<string, CacheEntry> Entries);

    private static string CachePath(string projectRoot) =>
        Path.Combine(projectRoot, ".llm-wiki", "ingest-cache.json");

    private static string Sha256(string content)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(content));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }

    private static async Task<List<string>?> CheckIngestCacheAsync(
        string projectRoot, string sourceFileName, string sourceContent)
    {
        try
        {
            var path = CachePath(projectRoot);
            if (!File.Exists(path)) return null;
            var raw = await File.ReadAllTextAsync(path);
            var data = JsonSerializer.Deserialize<CacheData>(raw,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            if (data?.Entries.TryGetValue(sourceFileName, out var entry) != true) return null;
            if (entry.Hash != Sha256(sourceContent)) return null;
            foreach (var f in entry.FilesWritten)
                if (!File.Exists(Path.Combine(projectRoot, f.Replace('/', Path.DirectorySeparatorChar))))
                    return null;
            return entry.FilesWritten;
        }
        catch { return null; }
    }

    private static async Task SaveIngestCacheAsync(
        string projectRoot, string sourceFileName, string sourceContent, List<string> writtenPaths)
    {
        try
        {
            var path = CachePath(projectRoot);
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            CacheData data;
            if (File.Exists(path))
            {
                var raw = await File.ReadAllTextAsync(path);
                data = JsonSerializer.Deserialize<CacheData>(raw,
                    new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
                    ?? new CacheData(new());
            }
            else data = new CacheData(new());

            data.Entries[sourceFileName] = new CacheEntry(
                Sha256(sourceContent),
                DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                writtenPaths);
            await File.WriteAllTextAsync(path,
                JsonSerializer.Serialize(data, new JsonSerializerOptions { WriteIndented = true }));
        }
        catch { /* non-critical */ }
    }

    // ── Prompt builders ───────────────────────────────────────────────────

    private static string BuildAnalysisPrompt(string purpose, string index, string sourceContent)
    {
        var parts = new List<string>
        {
            "You are an expert research analyst. Read the source document and produce a structured analysis.",
            "Do not output chain-of-thought, hidden reasoning, or a thinking transcript. Reason internally and write only the concise final analysis.",
            "",
            "Your analysis should cover:",
            "",
            "## Key Entities",
            "List people, organizations, products, datasets, tools mentioned. For each:",
            "- Name and type",
            "- Role in the source (central vs. peripheral)",
            "- Whether it likely already exists in the wiki (check the index)",
            "",
            "## Key Concepts",
            "List theories, methods, techniques, phenomena. For each:",
            "- Name and brief definition",
            "- Why it matters in this source",
            "- Whether it likely already exists in the wiki",
            "",
            "## Main Arguments & Findings",
            "- What are the core claims or results?",
            "- What evidence supports them?",
            "- How strong is the evidence?",
            "",
            "## Connections to Existing Wiki",
            "- What existing pages does this source relate to?",
            "- Does it strengthen, challenge, or extend existing knowledge?",
            "",
            "## Contradictions & Tensions",
            "- Does anything in this source conflict with existing wiki content?",
            "- Are there internal tensions or caveats?",
            "",
            "## Recommendations",
            "- What wiki pages should be created or updated?",
            "- What should be emphasized vs. de-emphasized?",
            "- Any open questions worth flagging for the user?",
            "",
            "Be thorough but concise. Focus on what's genuinely important.",
        };
        if (!string.IsNullOrEmpty(purpose))
            parts.Add($"\n## Wiki Purpose (for context)\n{purpose}");
        if (!string.IsNullOrEmpty(index))
            parts.Add($"\n## Current Wiki Index (for checking existing content)\n{index}");
        return string.Join("\n", parts);
    }

    private static string BuildGenerationPrompt(
        string schema, string purpose, string index,
        string sourceFileName, string overview, string sourceContent)
    {
        var sourceBaseName = Path.GetFileNameWithoutExtension(sourceFileName);
        var parts = new List<string>
        {
            "You are a wiki maintainer. Based on the analysis provided, generate wiki files.",
            "Do not output chain-of-thought, hidden reasoning, or explanatory preamble. Output only the requested FILE blocks.",
            "",
            $"## IMPORTANT: Source File",
            $"The original source file is: **{sourceFileName}**",
            $"All wiki pages generated from this source MUST include this filename in their frontmatter `sources` field.",
            "",
            "## What to generate",
            "",
            $"1. A source summary page at **wiki/sources/{sourceBaseName}.md** (MUST use this exact path)",
            "2. Entity pages in wiki/entities/ for key entities identified in the analysis",
            "3. Concept pages in wiki/concepts/ for key concepts identified in the analysis",
            "4. An updated wiki/index.md — add new entries to existing categories, preserve all existing entries",
            "5. A log entry for wiki/log.md (just the new entry, format: ## [YYYY-MM-DD] ingest | Title)",
            "6. An updated wiki/overview.md — comprehensive 2-5 paragraph overview of ALL topics in the wiki",
            "",
            "## Frontmatter Rules (CRITICAL — parser is strict)",
            "",
            "Every page begins with a YAML frontmatter block:",
            "1. The VERY FIRST line MUST be exactly `---`",
            "2. Required fields: type, title, created, updated, tags, related, sources",
            "3. Arrays use inline YAML form: `tags: [a, b, c]`",
            "4. The `sources` field MUST include the source filename",
            "",
            "## FILE Block Format",
            "",
            "Each file MUST use this exact format:",
            "```",
            "---FILE: wiki/path/to/file.md---",
            "[file content here]",
            "---END FILE---",
            "```",
            "- Start with `---FILE: path---` on its own line",
            "- End with `---END FILE---` on its own line",
            "- No extra text between FILE blocks",
        };
        if (!string.IsNullOrEmpty(schema))
            parts.Add($"\n## Wiki Schema\n{schema}");
        if (!string.IsNullOrEmpty(overview))
            parts.Add($"\n## Current Wiki Overview\n{overview}");
        if (!string.IsNullOrEmpty(index))
            parts.Add($"\n## Current Wiki Index\n{index}");
        return string.Join("\n", parts);
    }
}
