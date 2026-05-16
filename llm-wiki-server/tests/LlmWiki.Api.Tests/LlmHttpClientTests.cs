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

    [Fact]
    public void ParseAnthropicDeltaLine_TextDelta_ReturnsToken()
    {
        var line = """data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"world"}}""";
        Assert.Equal("world", LlmHttpClient.ParseAnthropicDeltaLine(line));
    }

    [Fact]
    public void ParseAnthropicDeltaLine_NonTextDelta_ReturnsNull()
    {
        var line = """data: {"type":"message_start","message":{}}""";
        Assert.Null(LlmHttpClient.ParseAnthropicDeltaLine(line));
    }
}
