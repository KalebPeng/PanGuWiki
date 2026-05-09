using System.Net;
using System.Net.Http.Json;
using LlmWiki.Api.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;

namespace LlmWiki.Api.Tests;

public class CloudWikiControllerTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString());
    private readonly string _projectRoot;
    private readonly WebApplicationFactory<Program> _factory;

    public CloudWikiControllerTests()
    {
        Directory.CreateDirectory(_dir);
        _projectRoot = new ProjectService().CreateProject("cloud-api-project", _dir).Path;
        Directory.CreateDirectory(Path.Combine(_projectRoot, "wiki", "concepts"));
        File.WriteAllText(
            Path.Combine(_projectRoot, "wiki", "concepts", "考勤制度.md"),
            "---\ntitle: 考勤制度\n---\n# 考勤制度\n\n忘打卡累计三次按旷工半天处理。");

        _factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) =>
            {
                config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["LlmWikiCloud:ApiKey"] = "test-token",
                    ["LlmWikiCloud:Projects:proj_123"] = _projectRoot
                });
            });
        });
    }

    public void Dispose()
    {
        _factory.Dispose();
        if (Directory.Exists(_dir))
            Directory.Delete(_dir, recursive: true);
    }

    [Fact]
    public async Task Search_RequiresBearerToken()
    {
        var client = _factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            "/api/projects/proj_123/wiki/search",
            new { query = "考勤", limit = 5 });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Search_ReturnsCamelCaseResultsForAuthorizedClient()
    {
        var client = AuthorizedClient();

        var response = await client.PostAsJsonAsync(
            "/api/projects/proj_123/wiki/search",
            new { query = "忘打卡", limit = 5 });

        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"relativePath\"", body);
        Assert.Contains("考勤制度", body);
    }

    [Fact]
    public async Task ReadPage_ReturnsPageContent()
    {
        var client = AuthorizedClient();

        var response = await client.GetAsync(
            "/api/projects/proj_123/wiki/pages/read?path_or_title=%E8%80%83%E5%8B%A4%E5%88%B6%E5%BA%A6");

        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"relativePath\"", body);
        Assert.Contains("忘打卡累计三次", body);
    }

    private HttpClient AuthorizedClient()
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new("Bearer", "test-token");
        return client;
    }
}
