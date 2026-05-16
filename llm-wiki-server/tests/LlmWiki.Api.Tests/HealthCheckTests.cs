namespace LlmWiki.Api.Tests;

public class HealthCheckTests(TestWebApplicationFactory factory)
    : IClassFixture<TestWebApplicationFactory>
{
    [Fact]
    public async Task HealthEndpoint_Returns200()
    {
        var client = factory.CreateClient();
        var response = await client.GetAsync("/health");
        Assert.Equal(System.Net.HttpStatusCode.OK, response.StatusCode);
    }
}
