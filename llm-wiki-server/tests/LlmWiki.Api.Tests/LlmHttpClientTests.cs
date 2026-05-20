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

    [Fact]
    public void ParseGeminiLine_ContentDelta_ReturnsToken()
    {
        var line = """data: {"candidates":[{"content":{"parts":[{"text":"hello"}],"role":"model"}}]}""";
        Assert.Equal("hello", LlmHttpClient.ParseGeminiLine(line));
    }

    [Theory]
    [InlineData("", null)]
    [InlineData("event: ping", null)]
    [InlineData(": heartbeat", null)]
    public void ParseGeminiLine_NonContent_ReturnsNull(string line, string? expected)
        => Assert.Equal(expected, LlmHttpClient.ParseGeminiLine(line));

    [Fact]
    public void ParseGeminiLine_NoTextField_ReturnsNull()
    {
        var line = """data: {"candidates":[{"content":{"parts":[{"inlineData":{}}],"role":"model"}}]}""";
        Assert.Null(LlmHttpClient.ParseGeminiLine(line));
    }

    [Fact]
    public void ParseGeminiLine_EmptyParts_ReturnsNull()
    {
        var line = """data: {"candidates":[{"content":{"parts":[],"role":"model"}}]}""";
        Assert.Null(LlmHttpClient.ParseGeminiLine(line));
    }

    [Theory]
    [InlineData(
        "https://generativelanguage.googleapis.com",
        "gemini-2.0-flash", "key123",
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?key=key123&alt=sse")]
    [InlineData(
        "https://generativelanguage.googleapis.com/v1beta",
        "gemini-2.0-flash", "key123",
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?key=key123&alt=sse")]
    [InlineData(
        "https://generativelanguage.googleapis.com/v1beta/",
        "gemini-2.0-flash", "key123",
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?key=key123&alt=sse")]
    public void BuildGeminiUrl_NormalizesEndpoint(string endpoint, string model, string key, string expected)
        => Assert.Equal(expected, LlmHttpClient.BuildGeminiUrl(endpoint, model, key));

    [Theory]
    [InlineData("https://api.example.com/path?key=secret", "https://api.example.com/path?key=REDACTED")]
    [InlineData("https://api.example.com/path?key=secret&alt=sse", "https://api.example.com/path?key=REDACTED&alt=sse")]
    [InlineData("https://api.example.com/path?other=1", "https://api.example.com/path?other=1")]
    public void RedactQueryKey_StripsApiKey(string input, string expected)
        => Assert.Equal(expected, LlmHttpClient.RedactQueryKey(input));
}
