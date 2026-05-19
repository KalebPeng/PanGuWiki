using LlmWiki.Api.Infrastructure.EmbeddingClient;

namespace LlmWiki.Api.Tests;

public class EmbeddingHttpClientTests
{
    [Fact]
    public void ParseOpenAiResponse_ReturnsSortedEmbeddings()
    {
        // index 1 comes first in JSON, must be sorted to [0,1] order
        var json = """{"data":[{"index":1,"embedding":[0.2,0.3]},{"index":0,"embedding":[0.0,0.1]}]}""";
        var result = EmbeddingHttpClient.ParseOpenAiResponse(json);
        Assert.Equal(2, result.Length);
        Assert.Equal([0.0f, 0.1f], result[0]);
        Assert.Equal([0.2f, 0.3f], result[1]);
    }

    [Fact]
    public void ParseGoogleBatchResponse_ReturnsEmbeddingsInOrder()
    {
        var json = """{"embeddings":[{"values":[0.1,0.2]},{"values":[0.3,0.4]}]}""";
        var result = EmbeddingHttpClient.ParseGoogleBatchResponse(json);
        Assert.Equal(2, result.Length);
        Assert.Equal([0.1f, 0.2f], result[0]);
        Assert.Equal([0.3f, 0.4f], result[1]);
    }

    [Fact]
    public void NormalizeOpenAiBase_StripsTrailingV1()
    {
        Assert.Equal("https://api.openai.com",
            EmbeddingHttpClient.NormalizeOpenAiBase("https://api.openai.com/v1"));
        Assert.Equal("https://api.openai.com",
            EmbeddingHttpClient.NormalizeOpenAiBase("https://api.openai.com"));
        Assert.Equal("https://api.openai.com",
            EmbeddingHttpClient.NormalizeOpenAiBase("https://api.openai.com/v1/"));
    }

    [Theory]
    [InlineData(
        "https://generativelanguage.googleapis.com",
        "text-embedding-004", "mykey",
        "https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:batchEmbedContents?key=mykey")]
    [InlineData(
        "https://generativelanguage.googleapis.com/v1beta",
        "text-embedding-004", "mykey",
        "https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:batchEmbedContents?key=mykey")]
    public void BuildGoogleBatchUrl_NormalizesEndpoint(
        string endpoint, string model, string key, string expected)
        => Assert.Equal(expected, EmbeddingHttpClient.BuildGoogleBatchUrl(endpoint, model, key));
}
