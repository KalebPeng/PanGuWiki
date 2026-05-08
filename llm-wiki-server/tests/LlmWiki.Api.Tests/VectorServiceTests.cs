using LlmWiki.Api.Models;
using LlmWiki.Api.Services;
using Microsoft.Extensions.Configuration;

namespace LlmWiki.Api.Tests;

[Trait("Category", "Integration")]
public class VectorServiceTests : IAsyncLifetime
{
    private readonly VectorService _sut;
    private readonly string _projectPath = $"/tmp/vstest-{Guid.NewGuid():N}";

    public VectorServiceTests()
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Qdrant:Host"] = "localhost",
                ["Qdrant:Port"] = "6334",
            })
            .Build();
        _sut = new VectorService(config);
    }

    public Task InitializeAsync() => Task.CompletedTask;
    public async Task DisposeAsync()
    {
        try { await _sut.DropCollection(_projectPath); } catch { /* ignore */ }
    }

    [Fact]
    public async Task UpsertChunks_ThenCount_ReturnsChunkCount()
    {
        var chunks = MakeChunks("page-a", 3, 16);
        await _sut.UpsertChunks(_projectPath, "page-a", chunks);
        Assert.Equal(3ul, await _sut.CountChunks(_projectPath));
    }

    [Fact]
    public async Task UpsertChunks_ReplacesExisting()
    {
        await _sut.UpsertChunks(_projectPath, "page-a", MakeChunks("page-a", 5, 16));
        await _sut.UpsertChunks(_projectPath, "page-a", MakeChunks("page-a", 2, 16));
        Assert.Equal(2ul, await _sut.CountChunks(_projectPath));
    }

    [Fact]
    public async Task SearchChunks_ReturnsResults()
    {
        await _sut.UpsertChunks(_projectPath, "page-a", MakeChunks("page-a", 3, 16));
        var results = await _sut.SearchChunks(_projectPath, FakeEmbedding(1, 16), 10);
        Assert.NotEmpty(results);
        Assert.All(results, r => Assert.Equal("page-a", r.PageId));
    }

    [Fact]
    public async Task DeletePage_RemovesOnlyItsChunks()
    {
        await _sut.UpsertChunks(_projectPath, "page-a", MakeChunks("page-a", 3, 16));
        await _sut.UpsertChunks(_projectPath, "page-b", MakeChunks("page-b", 2, 16));
        await _sut.DeletePage(_projectPath, "page-a");
        Assert.Equal(2ul, await _sut.CountChunks(_projectPath));
    }

    private static ChunkUpsertInput[] MakeChunks(string pageId, int n, int dim) =>
        Enumerable.Range(0, n).Select(i =>
            new ChunkUpsertInput((uint)i, $"{pageId} chunk {i}", $"## Heading {i}", FakeEmbedding((uint)i, dim))
        ).ToArray();

    private static float[] FakeEmbedding(uint seed, int dim) =>
        Enumerable.Range(0, dim).Select(i =>
            MathF.Sin(((seed * 2654435761u) ^ (uint)i) / (float)uint.MaxValue)
        ).ToArray();
}
