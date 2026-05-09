using LlmWiki.Api.Services;
using Microsoft.Extensions.Options;

namespace LlmWiki.Api.Tests;

public class ProjectServiceTests : IDisposable
{
    private readonly string _tempDir = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString());
    private readonly ProjectService _sut;

    public ProjectServiceTests()
    {
        _sut = new(Options.Create(new WikiProjectsOptions { RootPath = _tempDir }));
    }

    public void Dispose()
    {
        if (Directory.Exists(_tempDir))
            Directory.Delete(_tempDir, recursive: true);
    }

    [Fact]
    public void CreateProject_CreatesRequiredDirectories()
    {
        var result = _sut.CreateProject("my-wiki", _tempDir);

        Assert.Equal("my-wiki", result.Name);
        Assert.True(Directory.Exists(Path.Combine(result.Path, "wiki")));
        Assert.True(Directory.Exists(Path.Combine(result.Path, "raw/sources")));
        Assert.True(File.Exists(Path.Combine(result.Path, "schema.md")));
        Assert.True(File.Exists(Path.Combine(result.Path, "wiki/index.md")));
    }

    [Fact]
    public void CreateProject_ThrowsWhenDirectoryExists()
    {
        _sut.CreateProject("dup", _tempDir);
        var ex = Assert.Throws<InvalidOperationException>(() => _sut.CreateProject("dup", _tempDir));
        Assert.Contains("already exists", ex.Message);
    }

    [Fact]
    public void OpenProject_ReturnsProjectForValidPath()
    {
        var created = _sut.CreateProject("open-test", _tempDir);
        var opened = _sut.OpenProject(created.Path);
        Assert.Equal("open-test", opened.Name);
        Assert.Equal(created.Path, opened.Path);
    }

    [Fact]
    public void OpenProject_ThrowsWhenMissingSchemaFile()
    {
        Directory.CreateDirectory(_tempDir);
        Directory.CreateDirectory(Path.Combine(_tempDir, "wiki"));
        var ex = Assert.Throws<InvalidOperationException>(() => _sut.OpenProject(_tempDir));
        Assert.Contains("Not a valid wiki project", ex.Message);
    }

    [Fact]
    public void DiscoverProjects_ReturnsOnlyValidProjectsUnderConfiguredRoot()
    {
        var valid = _sut.CreateProject("valid-project", _tempDir);
        Directory.CreateDirectory(Path.Combine(_tempDir, "not-a-project"));

        var projects = _sut.DiscoverProjects();

        var project = Assert.Single(projects);
        Assert.Equal(valid.Path, project.Path);
        Assert.Equal("valid-project", project.Name);
    }

    [Fact]
    public void GetProjectRootPath_ReturnsConfiguredRoot()
    {
        var rootPath = _sut.GetProjectRootPath();

        Assert.Equal(_tempDir.Replace('\\', '/'), rootPath);
    }
}
