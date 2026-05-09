using System.Text.Json;
using LlmWiki.Api.Services;

namespace LlmWiki.Api.Tests;

public class ClaudeMessageTests
{
    [Fact]
    public void DeserializesBrowserMessageFields()
    {
        var json = """
        [
          { "role": "system", "content": "You are helpful." },
          { "role": "user", "content": "Analyze this source." }
        ]
        """;

        var messages = JsonSerializer.Deserialize<List<ClaudeMessage>>(json);

        Assert.NotNull(messages);
        Assert.Equal("system", messages[0].Role);
        Assert.Equal("You are helpful.", messages[0].Content);
        Assert.Equal("user", messages[1].Role);
        Assert.Equal("Analyze this source.", messages[1].Content);
    }
}
