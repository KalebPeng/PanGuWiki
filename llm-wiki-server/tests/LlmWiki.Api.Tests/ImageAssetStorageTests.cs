using LlmWiki.Api.Infrastructure.ImageAssets;
using Microsoft.Extensions.Options;

namespace LlmWiki.Api.Tests;

[Trait("ClassName", "LlmWiki.Api.Tests.ImageAssetStorageTests")]
public class ImageAssetStorageTests
{
    [Fact]
    public async Task SaveAsync_WritesUnderConfiguredRootAndReadAsyncReturnsBytes()
    {
        var root = Path.Combine(Path.GetTempPath(), "llmwiki-image-assets", Guid.NewGuid().ToString("N"));
        var storage = new ImageAssetStorage(Options.Create(new ImageAssetOptions { RootPath = root }));
        var deptId = Guid.NewGuid();
        var userId = Guid.NewGuid();
        var imageId = Guid.NewGuid();
        var bytes = new byte[] { 137, 80, 78, 71 };

        var relativePath = await storage.SaveAsync(deptId, userId, imageId, "image/png", bytes, CancellationToken.None);
        var saved = await storage.ReadAsync(relativePath, CancellationToken.None);

        Assert.Equal(bytes, saved.Bytes);
        Assert.Equal("image/png", saved.MimeType);
        Assert.StartsWith(root, Path.GetFullPath(Path.Combine(root, relativePath)));
    }

    [Fact]
    public async Task SaveAsync_WritesJpegWithJpgExtensionAndReadAsyncReturnsJpegMimeType()
    {
        var root = Path.Combine(Path.GetTempPath(), "llmwiki-image-assets", Guid.NewGuid().ToString("N"));
        var storage = new ImageAssetStorage(Options.Create(new ImageAssetOptions { RootPath = root }));
        var bytes = new byte[] { 255, 216, 255 };

        var relativePath = await storage.SaveAsync(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), "image/jpeg", bytes, CancellationToken.None);
        var saved = await storage.ReadAsync(relativePath, CancellationToken.None);

        Assert.EndsWith(".jpg", relativePath);
        Assert.Equal(bytes, saved.Bytes);
        Assert.Equal("image/jpeg", saved.MimeType);
    }

    [Fact]
    public async Task ReadAsync_ThrowsWhenRelativePathLeavesRoot()
    {
        var root = Path.Combine(Path.GetTempPath(), "llmwiki-image-assets", Guid.NewGuid().ToString("N"));
        var storage = new ImageAssetStorage(Options.Create(new ImageAssetOptions { RootPath = root }));

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            storage.ReadAsync("../outside.png", CancellationToken.None));
    }

    [Fact]
    public async Task ReadAsync_ThrowsWhenCaseVariantSiblingLeavesRootOnCaseSensitiveFileSystems()
    {
        if (OperatingSystem.IsWindows() || OperatingSystem.IsMacOS())
        {
            return;
        }

        var parent = Path.Combine(Path.GetTempPath(), "llmwiki-image-assets", Guid.NewGuid().ToString("N"));
        var root = Path.Combine(parent, "image-assets");
        var storage = new ImageAssetStorage(Options.Create(new ImageAssetOptions { RootPath = root }));

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            storage.ReadAsync("../Image-assets/foo.png", CancellationToken.None));
    }

    [Fact]
    public async Task ReadAsync_ThrowsWhenFileDoesNotExist()
    {
        var root = Path.Combine(Path.GetTempPath(), "llmwiki-image-assets", Guid.NewGuid().ToString("N"));
        var storage = new ImageAssetStorage(Options.Create(new ImageAssetOptions { RootPath = root }));

        await Assert.ThrowsAsync<FileNotFoundException>(() =>
            storage.ReadAsync("missing.png", CancellationToken.None));
    }

    [Fact]
    public async Task DeleteAsync_RemovesExistingFileAndRejectsTraversal()
    {
        var root = Path.Combine(Path.GetTempPath(), "llmwiki-image-assets", Guid.NewGuid().ToString("N"));
        var storage = new ImageAssetStorage(Options.Create(new ImageAssetOptions { RootPath = root }));
        var relativePath = await storage.SaveAsync(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), "image/png", [1, 2, 3], CancellationToken.None);

        await storage.DeleteAsync(relativePath);

        await Assert.ThrowsAsync<FileNotFoundException>(() =>
            storage.ReadAsync(relativePath, CancellationToken.None));
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            storage.DeleteAsync("../outside.png"));
    }
}
