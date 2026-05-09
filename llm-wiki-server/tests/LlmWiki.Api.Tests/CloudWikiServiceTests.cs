using LlmWiki.Api.Services;
using Microsoft.Extensions.Options;

namespace LlmWiki.Api.Tests;

public class CloudWikiServiceTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString());
    private readonly string _projectRoot;
    private readonly CloudWikiService _sut;

    public CloudWikiServiceTests()
    {
        Directory.CreateDirectory(_dir);
        _projectRoot = new ProjectService().CreateProject("cloud-project", _dir).Path;
        Directory.CreateDirectory(Path.Combine(_projectRoot, "wiki", "concepts"));
        File.WriteAllText(Path.Combine(_projectRoot, "purpose.md"), "# 项目目标\n\n整理人资制度。");
        File.WriteAllText(Path.Combine(_projectRoot, "wiki", "overview.md"), "---\ntitle: 维基概览\n---\n# 维基概览\n\n人资制度概览。");
        File.WriteAllText(Path.Combine(_projectRoot, "wiki", "index.md"), "# 维基索引\n\n- [[盘古网络假期政策]]");
        File.WriteAllText(
            Path.Combine(_projectRoot, "wiki", "concepts", "盘古网络假期政策.md"),
            "---\ntitle: 盘古网络假期政策\n---\n# 盘古网络假期政策\n\n年假、婚假、产假和病假规则。");

        _sut = new CloudWikiService(Options.Create(new CloudWikiOptions
        {
            Projects = new Dictionary<string, string>
            {
                ["proj_123"] = _projectRoot
            }
        }));
    }

    public void Dispose()
    {
        if (Directory.Exists(_dir))
            Directory.Delete(_dir, recursive: true);
    }

    [Fact]
    public async Task ListPages_ReturnsMarkdownPagesWithTitles()
    {
        var pages = await _sut.ListPages("proj_123");

        Assert.Contains(pages, p =>
            p.Title == "盘古网络假期政策" &&
            p.RelativePath == "wiki/concepts/盘古网络假期政策.md");
    }

    [Fact]
    public async Task Search_RanksChineseTitleMatch()
    {
        var results = await _sut.Search("proj_123", new CloudWikiSearchRequest("假期", 5));

        var top = Assert.IsAssignableFrom<IReadOnlyList<CloudWikiSearchResult>>(results).First();
        Assert.Equal("盘古网络假期政策", top.Title);
        Assert.Contains("年假", top.Snippet);
    }

    [Fact]
    public async Task ReadPage_ResolvesTitleAndPath()
    {
        var byTitle = await _sut.ReadPage("proj_123", "盘古网络假期政策");
        var byPath = await _sut.ReadPage("proj_123", "wiki/concepts/盘古网络假期政策.md");

        Assert.Equal(byTitle.Content, byPath.Content);
        Assert.Equal("盘古网络假期政策", byTitle.Title);
    }

    [Fact]
    public async Task GetOverview_AggregatesPurposeOverviewAndIndex()
    {
        var overview = await _sut.GetOverview("proj_123");

        Assert.Contains("# purpose.md", overview);
        Assert.Contains("# wiki/overview.md", overview);
        Assert.Contains("# wiki/index.md", overview);
    }

    [Fact]
    public async Task ReadPage_RejectsTraversalOutsideWiki()
    {
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            _sut.ReadPage("proj_123", "../purpose.md"));

        Assert.Contains("outside wiki", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task UnknownProject_ThrowsKeyNotFound()
    {
        await Assert.ThrowsAsync<KeyNotFoundException>(() => _sut.ListPages("missing"));
    }
}
