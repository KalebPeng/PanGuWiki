using LlmWiki.Api.Models;
using LlmWiki.Api.Services;

namespace LlmWiki.Api.Tests;

public class FileServiceTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString());
    private readonly string _projectRoot;
    private readonly FileService _sut;

    public FileServiceTests()
    {
        Directory.CreateDirectory(_dir);
        _projectRoot = new ProjectService().CreateProject("test-project", _dir).Path;
        _sut = new FileService(new PdfExtractService(), new OfficeExtractService());
    }

    public void Dispose()
    {
        if (Directory.Exists(_dir))
            Directory.Delete(_dir, recursive: true);
    }

    [Fact]
    public async Task ReadFile_ReturnsContent()
    {
        var path = Path.Combine(_projectRoot, "wiki", "test.md");
        await File.WriteAllTextAsync(path, "# Hello");
        var content = await _sut.ReadFile(path);
        Assert.Equal("# Hello", content);
    }

    [Fact]
    public async Task WriteFile_CreatesFile()
    {
        var path = Path.Combine(_projectRoot, "wiki", "sub", "new.md");
        await _sut.WriteFile(path, "content");
        Assert.Equal("content", await File.ReadAllTextAsync(path));
    }

    [Fact]
    public async Task FileExists_ReturnsTrueForExistingFile()
    {
        var path = Path.Combine(_projectRoot, "wiki", "exists.md");
        await File.WriteAllTextAsync(path, "x");
        Assert.True(await _sut.FileExists(path));
        Assert.False(await _sut.FileExists(path + ".nope"));
    }

    [Fact]
    public async Task ListDirectory_ReturnsTree()
    {
        await File.WriteAllTextAsync(Path.Combine(_projectRoot, "wiki", "a.md"), "");
        var subDir = Directory.CreateDirectory(Path.Combine(_projectRoot, "wiki", "sub"));
        await File.WriteAllTextAsync(Path.Combine(subDir.FullName, "b.md"), "");

        var nodes = await _sut.ListDirectory(Path.Combine(_projectRoot, "wiki"));

        Assert.Contains(nodes, n => n.Name == "a.md" && !n.IsDir);
        Assert.Contains(nodes, n => n.Name == "sub" && n.IsDir);
        var sub = nodes.First(n => n.Name == "sub");
        Assert.Contains(sub.Children!, n => n.Name == "b.md");
    }

    [Fact]
    public async Task DeleteFile_RemovesFile()
    {
        var path = Path.Combine(_projectRoot, "wiki", "del.md");
        await File.WriteAllTextAsync(path, "x");
        await _sut.DeleteFile(path);
        Assert.False(File.Exists(path));
    }

    [Fact]
    public async Task CopyDirectory_CopiesFilesRecursively()
    {
        var src = Path.Combine(_dir, "src");
        var dst = Path.Combine(_projectRoot, "raw", "sources", "dst");
        Directory.CreateDirectory(Path.Combine(src, "sub"));
        await File.WriteAllTextAsync(Path.Combine(src, "root.md"), "root");
        await File.WriteAllTextAsync(Path.Combine(src, "sub", "child.md"), "child");

        var copied = await _sut.CopyDirectory(src, dst);

        Assert.Equal(2, copied.Count);
        Assert.True(File.Exists(Path.Combine(dst, "root.md")));
        Assert.True(File.Exists(Path.Combine(dst, "sub", "child.md")));
        Assert.All(copied, p => Assert.DoesNotContain('\\', p));
    }

    [Fact]
    public async Task CopyDirectory_SkipsDotfiles()
    {
        var src = Path.Combine(_dir, "src2");
        var dst = Path.Combine(_projectRoot, "raw", "sources", "dst2");
        Directory.CreateDirectory(src);
        await File.WriteAllTextAsync(Path.Combine(src, "keep.md"), "keep");
        await File.WriteAllTextAsync(Path.Combine(src, ".DS_Store"), "junk");

        var copied = await _sut.CopyDirectory(src, dst);

        Assert.Single(copied);
        Assert.False(File.Exists(Path.Combine(dst, ".DS_Store")));
    }

    [Fact]
    public async Task WriteFile_RejectsPathsOutsideWikiProject()
    {
        var outside = Path.Combine(Path.GetTempPath(), Guid.NewGuid() + ".md");

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            _sut.WriteFile(outside, "x"));

        Assert.Contains("wiki project", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task CopyDirectory_AllowsExternalSourceButRequiresProjectDestination()
    {
        var externalSrc = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString());
        Directory.CreateDirectory(externalSrc);
        await File.WriteAllTextAsync(Path.Combine(externalSrc, "a.md"), "a");

        try
        {
            var project = new ProjectService().CreateProject("copy-target", _dir);
            var copied = await _sut.CopyDirectory(
                externalSrc,
                Path.Combine(project.Path, "raw", "sources", "import"));

            Assert.Single(copied);
            Assert.True(File.Exists(Path.Combine(project.Path, "raw", "sources", "import", "a.md")));
        }
        finally
        {
            if (Directory.Exists(externalSrc))
                Directory.Delete(externalSrc, recursive: true);
        }
    }

    [Fact]
    public async Task FindRelatedWikiPages_FindsSourcesMatch()
    {
        var wikiDir = Path.Combine(_projectRoot, "wiki");
        var conceptsDir = Path.Combine(wikiDir, "concepts");
        Directory.CreateDirectory(conceptsDir);

        await File.WriteAllTextAsync(
            Path.Combine(conceptsDir, "test-concept.md"),
            "---\ntitle: Test\nsources: [\"myfile.pdf\"]\n---\nbody\n");
        await File.WriteAllTextAsync(
            Path.Combine(conceptsDir, "unrelated.md"),
            "---\ntitle: Unrelated\nsources: [\"other.pdf\"]\n---\nbody\n");

        var results = await _sut.FindRelatedWikiPages(_projectRoot, "myfile.pdf");

        Assert.Single(results);
        Assert.Contains("test-concept.md", results[0]);
    }
}
