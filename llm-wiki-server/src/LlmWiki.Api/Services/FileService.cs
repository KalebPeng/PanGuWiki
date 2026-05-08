using LlmWiki.Api.Models;

namespace LlmWiki.Api.Services;

public class FileService(PdfExtractService pdfExtract, OfficeExtractService officeExtract)
{
    private static readonly string[] OfficeExts = ["docx", "pptx", "xlsx", "odt", "ods", "odp"];
    private static readonly string[] ImageExts = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "tiff", "tif", "avif", "heic", "heif", "svg"];
    private static readonly string[] MediaExts = ["mp4", "webm", "mov", "avi", "mkv", "flv", "mp3", "wav", "ogg", "flac", "aac", "m4a"];
    private static readonly string[] LegacyExts = ["doc", "xls", "ppt", "pages", "numbers", "key", "epub"];

    public async Task<string> ReadFile(string path)
    {
        EnsurePathWithinWikiProject(path);
        var ext = Path.GetExtension(path).TrimStart('.').ToLowerInvariant();

        if (TryReadCache(path, out var cached)) return cached!;

        if (ext == "pdf") return await pdfExtract.ExtractText(path);
        if (OfficeExts.Contains(ext)) return await officeExtract.ExtractText(path, ext);
        if (ImageExts.Contains(ext))
        {
            var size = new FileInfo(path).Length;
            return $"[Image: {Path.GetFileName(path)} ({size / 1024.0:F1} KB)]";
        }
        if (MediaExts.Contains(ext))
        {
            var size = new FileInfo(path).Length;
            return $"[Media: {Path.GetFileName(path)} ({size / 1048576.0:F1} MB)]";
        }
        if (LegacyExts.Contains(ext))
            return $"[Document: {Path.GetFileName(path)} — text extraction not supported for .{ext} format]";

        return await File.ReadAllTextAsync(path);
    }

    public async Task WriteFile(string path, string contents)
    {
        EnsurePathWithinWikiProject(path, allowNonExistent: true);
        var dir = Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
        await File.WriteAllTextAsync(path, contents);
    }

    public Task<bool> FileExists(string path) =>
        Task.FromResult(IsPathWithinWikiProject(path, allowNonExistent: true) && (File.Exists(path) || Directory.Exists(path)));

    public async Task<string> PreprocessFile(string path)
    {
        EnsurePathWithinWikiProject(path);
        var ext = Path.GetExtension(path).TrimStart('.').ToLowerInvariant();
        string text;
        if (ext == "pdf") text = await pdfExtract.ExtractText(path);
        else if (OfficeExts.Contains(ext)) text = await officeExtract.ExtractText(path, ext);
        else return "no preprocessing needed";

        WriteCache(path, text);
        return text;
    }

    public Task<List<FileNode>> ListDirectory(string path, int maxDepth = 30) =>
        Task.FromResult(BuildTree(EnsurePathWithinWikiProject(path), 0, maxDepth));

    public Task CreateDirectory(string path)
    {
        EnsurePathWithinWikiProject(path, allowNonExistent: true);
        Directory.CreateDirectory(path);
        return Task.CompletedTask;
    }

    public Task DeleteFile(string path)
    {
        EnsurePathWithinWikiProject(path, allowNonExistent: true);
        if (Directory.Exists(path)) Directory.Delete(path, recursive: true);
        else if (File.Exists(path)) File.Delete(path);
        return Task.CompletedTask;
    }

    public Task CopyFile(string source, string destination)
    {
        EnsureExistingFileSystemEntry(source);
        EnsurePathWithinWikiProject(destination, allowNonExistent: true);
        var dir = Path.GetDirectoryName(destination);
        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
        File.Copy(source, destination, overwrite: true);
        return Task.CompletedTask;
    }

    public Task<List<string>> CopyDirectory(string source, string destination)
    {
        EnsureExistingDirectory(source);
        EnsurePathWithinWikiProject(destination, allowNonExistent: true);
        var copied = new List<string>();
        CopyRecursive(source, destination, copied);
        return Task.FromResult(copied);
    }

    public async Task<(string Base64, string MimeType)> ReadFileAsBase64(string path)
    {
        EnsurePathWithinWikiProject(path);
        var bytes = await File.ReadAllBytesAsync(path);
        var ext = Path.GetExtension(path).TrimStart('.').ToLowerInvariant();
        var mime = ext switch
        {
            "png" => "image/png",
            "jpg" or "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "webp" => "image/webp",
            "bmp" => "image/bmp",
            "tiff" or "tif" => "image/tiff",
            "svg" => "image/svg+xml",
            _ => "application/octet-stream"
        };
        return (Convert.ToBase64String(bytes), mime);
    }

    public Task<List<string>> FindRelatedWikiPages(string projectPath, string sourceName)
    {
        EnsurePathWithinWikiProject(projectPath);
        var wikiDir = Path.Combine(projectPath, "wiki");
        if (!Directory.Exists(wikiDir)) return Task.FromResult(new List<string>());
        var results = new List<string>();
        CollectRelatedPages(wikiDir, sourceName, results);
        return Task.FromResult(results);
    }

    // ── Private helpers ──────────────────────────────────────────────────

    private static List<FileNode> BuildTree(string dir, int depth, int maxDepth)
    {
        if (depth >= maxDepth) return [];
        try
        {
            var entries = Directory.GetFileSystemEntries(dir)
                .Where(e => !Path.GetFileName(e).StartsWith('.'))
                .OrderByDescending(Directory.Exists)
                .ThenBy(Path.GetFileName);

            return entries.Select(e =>
            {
                var name = Path.GetFileName(e);
                var isDir = Directory.Exists(e);
                var normPath = e.Replace('\\', '/');
                var children = isDir ? BuildTree(e, depth + 1, maxDepth) : null;
                return new FileNode(name, normPath, isDir, children?.Count > 0 ? children : null);
            }).ToList();
        }
        catch
        {
            return [];
        }
    }

    private static void CopyRecursive(string src, string dest, List<string> copied)
    {
        Directory.CreateDirectory(dest);
        foreach (var entry in Directory.GetFileSystemEntries(src))
        {
            var name = Path.GetFileName(entry);
            if (name.StartsWith('.')) continue;
            var destPath = Path.Combine(dest, name);
            if (Directory.Exists(entry))
                CopyRecursive(entry, destPath, copied);
            else
            {
                File.Copy(entry, destPath, overwrite: true);
                copied.Add(destPath.Replace('\\', '/'));
            }
        }
    }

    private static void CollectRelatedPages(string dir, string sourceName, List<string> results)
    {
        var fileName = Path.GetFileName(sourceName).ToLowerInvariant();
        var fileStem = Path.GetFileNameWithoutExtension(sourceName).ToLowerInvariant();

        foreach (var entry in Directory.GetFileSystemEntries(dir))
        {
            if (Directory.Exists(entry)) { CollectRelatedPages(entry, sourceName, results); continue; }
            if (!string.Equals(Path.GetExtension(entry), ".md", StringComparison.OrdinalIgnoreCase)) continue;

            var fname = Path.GetFileName(entry);
            if (fname is "index.md" or "log.md" or "overview.md") continue;

            try
            {
                var content = File.ReadAllText(entry);
                var contentLower = content.ToLowerInvariant();

                var quotedMatch = contentLower.Contains($"\"{fileName}\"") || contentLower.Contains($"'{fileName}'");
                var pathParts = entry.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
                var isInSourcesDir = pathParts.Contains("sources");
                var isSourceSummary = isInSourcesDir && fname.ToLowerInvariant().StartsWith(fileStem);
                var frontmatterMatch = CheckFrontmatterSources(content, fileName);

                if (quotedMatch || isSourceSummary || frontmatterMatch)
                    results.Add(entry.Replace('\\', '/'));
            }
            catch { /* skip unreadable files */ }
        }
    }

    private static bool CheckFrontmatterSources(string content, string fileName)
    {
        content = content.ReplaceLineEndings("\n");
        if (!content.StartsWith("---\n")) return false;
        var fmEnd = content.IndexOf("\n---", 4);
        if (fmEnd < 0) return false;
        var fm = content[4..fmEnd].ToLowerInvariant();
        var inSources = false;
        foreach (var line in fm.Split('\n'))
        {
            if (line.StartsWith("sources:"))
            {
                if (line.Contains(fileName)) return true;
                inSources = true; continue;
            }
            if (inSources)
            {
                if (line.Length == 0 || line[0] == ' ' || line[0] == '\t')
                { if (line.Contains(fileName)) return true; }
                else inSources = false;
            }
        }
        return false;
    }

    private static string CachePath(string original) =>
        Path.Combine(Path.GetDirectoryName(original)!, ".cache", Path.GetFileName(original) + ".txt");

    private static bool TryReadCache(string original, out string? content)
    {
        content = null;
        var cp = CachePath(original);
        if (!File.Exists(cp)) return false;
        var origMod = File.GetLastWriteTimeUtc(original);
        var cacheMod = File.GetLastWriteTimeUtc(cp);
        if (cacheMod < origMod) return false;
        content = File.ReadAllText(cp);
        return true;
    }

    private static void WriteCache(string original, string text)
    {
        var cp = CachePath(original);
        Directory.CreateDirectory(Path.GetDirectoryName(cp)!);
        File.WriteAllText(cp, text);
    }

    private static string EnsurePathWithinWikiProject(string path, bool allowNonExistent = false)
    {
        var fullPath = Path.GetFullPath(path);
        var probe = fullPath;

        if (allowNonExistent && !File.Exists(fullPath) && !Directory.Exists(fullPath))
        {
          var parent = Path.GetDirectoryName(fullPath);
          while (!string.IsNullOrEmpty(parent) && !Directory.Exists(parent) && !File.Exists(parent))
              parent = Path.GetDirectoryName(parent);
          probe = parent ?? fullPath;
        }

        var projectRoot = FindWikiProjectRoot(probe);
        if (projectRoot is null)
            throw new InvalidOperationException($"Path is outside a wiki project: '{path}'");

        var rootWithSep = projectRoot.EndsWith(Path.DirectorySeparatorChar) || projectRoot.EndsWith(Path.AltDirectorySeparatorChar)
            ? projectRoot
            : projectRoot + Path.DirectorySeparatorChar;

        if (!fullPath.Equals(projectRoot, StringComparison.OrdinalIgnoreCase) &&
            !fullPath.StartsWith(rootWithSep, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException($"Path is outside the resolved wiki project root: '{path}'");

        return fullPath;
    }

    private static bool IsPathWithinWikiProject(string path, bool allowNonExistent = false)
    {
        try
        {
            EnsurePathWithinWikiProject(path, allowNonExistent);
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static string? FindWikiProjectRoot(string path)
    {
        var current = Directory.Exists(path)
            ? new DirectoryInfo(path)
            : File.Exists(path)
                ? new FileInfo(path).Directory
                : new DirectoryInfo(Path.GetDirectoryName(path) ?? path);

        while (current is not null)
        {
            var schema = Path.Combine(current.FullName, "schema.md");
            var wiki = Path.Combine(current.FullName, "wiki");
            if (File.Exists(schema) && Directory.Exists(wiki))
                return current.FullName;
            current = current.Parent;
        }
        return null;
    }

    private static void EnsureExistingFileSystemEntry(string path)
    {
        if (!File.Exists(path) && !Directory.Exists(path))
            throw new InvalidOperationException($"Path does not exist: '{path}'");
    }

    private static void EnsureExistingDirectory(string path)
    {
        if (!Directory.Exists(path))
            throw new InvalidOperationException($"Directory does not exist: '{path}'");
    }
}
