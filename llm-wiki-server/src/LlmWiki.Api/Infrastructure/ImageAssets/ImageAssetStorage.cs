using Microsoft.Extensions.Options;

namespace LlmWiki.Api.Infrastructure.ImageAssets;

public class ImageAssetStorage
{
    private readonly string _rootPath;

    public ImageAssetStorage(IOptions<ImageAssetOptions> options)
    {
        _rootPath = Path.GetFullPath(options.Value.RootPath);
    }

    public async Task<string> SaveAsync(
        Guid departmentId,
        Guid userId,
        Guid imageId,
        string mimeType,
        byte[] bytes,
        CancellationToken ct)
    {
        var extension = string.Equals(mimeType, "image/jpeg", StringComparison.OrdinalIgnoreCase)
            ? ".jpg"
            : ".png";
        var now = DateTime.UtcNow;
        var relativePath = Path.Combine(
            departmentId.ToString("D"),
            "users",
            userId.ToString("D"),
            now.ToString("yyyy"),
            now.ToString("MM"),
            imageId.ToString("D") + extension);

        var fullPath = GetFullPathUnderRoot(relativePath);
        var directory = Path.GetDirectoryName(fullPath);
        if (directory is not null)
        {
            Directory.CreateDirectory(directory);
        }

        await File.WriteAllBytesAsync(fullPath, bytes, ct);
        return relativePath.Replace(Path.DirectorySeparatorChar, '/');
    }

    public async Task<(byte[] Bytes, string MimeType)> ReadAsync(string relativePath, CancellationToken ct)
    {
        var fullPath = GetFullPathUnderRoot(relativePath);
        if (!File.Exists(fullPath))
        {
            throw new FileNotFoundException("Image asset was not found.", fullPath);
        }

        var bytes = await File.ReadAllBytesAsync(fullPath, ct);
        return (bytes, GetMimeType(fullPath));
    }

    public Task DeleteAsync(string relativePath)
    {
        var fullPath = GetFullPathUnderRoot(relativePath);
        if (File.Exists(fullPath))
        {
            File.Delete(fullPath);
        }

        return Task.CompletedTask;
    }

    public Task DeleteAsync(string relativePath, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        return DeleteAsync(relativePath);
    }

    private string GetFullPathUnderRoot(string relativePath)
    {
        var fullPath = Path.GetFullPath(Path.Combine(_rootPath, relativePath));
        var root = Path.TrimEndingDirectorySeparator(_rootPath);
        if (!string.Equals(fullPath, root, StringComparison.OrdinalIgnoreCase) &&
            !fullPath.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("Image asset path must remain under the configured root.");
        }

        return fullPath;
    }

    private static string GetMimeType(string path)
    {
        var extension = Path.GetExtension(path);
        return string.Equals(extension, ".jpg", StringComparison.OrdinalIgnoreCase) ||
               string.Equals(extension, ".jpeg", StringComparison.OrdinalIgnoreCase)
            ? "image/jpeg"
            : "image/png";
    }
}
