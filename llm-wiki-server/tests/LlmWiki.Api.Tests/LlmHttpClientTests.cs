using LlmWiki.Api.Infrastructure.LlmClient;

namespace LlmWiki.Api.Tests;

public class LlmHttpClientTests
{
    [Theory]
    [InlineData("data: [DONE]", "[DONE]")]
    [InlineData("", null)]
    [InlineData("event: ping", null)]
    [InlineData(": heartbeat", null)]
    public void ParseOpenAiLine_NonContent_ReturnsExpected(string line, string? expected)
        => Assert.Equal(expected, LlmHttpClient.ParseOpenAiLine(line));

    [Fact]
    public void ParseOpenAiLine_ContentDelta_ReturnsToken()
    {
        var line = """data: {"choices":[{"delta":{"content":"hello"}}]}""";
        Assert.Equal("hello", LlmHttpClient.ParseOpenAiLine(line));
    }

    [Fact]
    public void ParseOpenAiLine_EmptyDelta_ReturnsNull()
    {
        var line = """data: {"choices":[{"delta":{}}]}""";
        Assert.Null(LlmHttpClient.ParseOpenAiLine(line));
    }
}
