using LlmWiki.Api.Infrastructure.LlmClient;

namespace LlmWiki.Api.Tests;

public class AnthropicUrlBuilderTests
{
    [Theory]
    [InlineData("https://api.anthropic.com", "https://api.anthropic.com/v1/messages")]
    [InlineData("https://api.anthropic.com/v1", "https://api.anthropic.com/v1/messages")]
    [InlineData("https://api.anthropic.com/v1/messages", "https://api.anthropic.com/v1/messages")]
    [InlineData("https://api.anthropic.com/v1/", "https://api.anthropic.com/v1/messages")]
    [InlineData("https://proxy.example.com/anthropic", "https://proxy.example.com/anthropic/v1/messages")]
    [InlineData("https://api.example.com/api/paas/v4", "https://api.example.com/api/paas/v4/messages")]
    public void Build_VariousInputs_ReturnsCorrectUrl(string input, string expected)
        => Assert.Equal(expected, AnthropicUrlBuilder.Build(input));
}
