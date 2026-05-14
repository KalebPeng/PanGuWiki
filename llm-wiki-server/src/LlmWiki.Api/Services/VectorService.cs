using LlmWiki.Api.Models;
using Microsoft.Extensions.Configuration;
using Qdrant.Client;
using Qdrant.Client.Grpc;

namespace LlmWiki.Api.Services;

public class VectorService
{
    private readonly QdrantClient _client;

    public VectorService(IConfiguration config)
    {
        var host = config["Qdrant:Host"] ?? "localhost";
        var port = config.GetValue<int>("Qdrant:Port", 6334);
        _client = new QdrantClient(host, port);
    }

    private static string CollectionName(string projectPath)
    {
        // Stable FNV-1a hash: same path always produces the same collection name.
        uint hash = 2166136261u;
        foreach (var c in projectPath)
        {
            hash ^= c;
            hash *= 16777619u;
        }
        return $"llmwiki_{hash:x8}";
    }

    private static string CollectionName(Guid deptId, string projectPath) =>
        CollectionName($"{deptId:N}:{projectPath}");
    // Uses :N format (32-char lowercase hex without hyphens) for stable hash input.

    private async Task EnsureCollection(string projectPath, uint dim)
    {
        var name = CollectionName(projectPath);
        var existing = await _client.ListCollectionsAsync();
        if (existing.Any(c => c == name)) return;
        await _client.CreateCollectionAsync(name, new VectorParams { Size = dim, Distance = Distance.Cosine });
    }

    public async Task UpsertChunks(string projectPath, string pageId, ChunkUpsertInput[] chunks)
    {
        if (chunks.Length == 0) return;
        ValidatePageId(pageId);
        var dim = (uint)chunks[0].Embedding.Length;
        await EnsureCollection(projectPath, dim);
        var name = CollectionName(projectPath);

        // Delete existing chunks for this page first
        await _client.DeleteAsync(name, Conditions.MatchKeyword("page_id", pageId));

        var points = chunks.Select(c => new PointStruct
        {
            Id = Guid.NewGuid(),
            Vectors = c.Embedding,
            Payload =
            {
                ["chunk_id"] = $"{pageId}#{c.ChunkIndex}",
                ["page_id"] = pageId,
                ["chunk_index"] = (long)c.ChunkIndex,
                ["chunk_text"] = c.ChunkText,
                ["heading_path"] = c.HeadingPath,
            }
        }).ToList();

        await _client.UpsertAsync(name, points);
    }

    public async Task<List<ChunkSearchResult>> SearchChunks(string projectPath, float[] queryEmbedding, int topK)
    {
        var name = CollectionName(projectPath);
        var existing = await _client.ListCollectionsAsync();
        if (!existing.Any(c => c == name)) return [];

        var results = await _client.SearchAsync(
            name,
            queryEmbedding,
            limit: (ulong)topK,
            payloadSelector: true);

        return results.Select(r => new ChunkSearchResult(
            r.Payload["chunk_id"].StringValue,
            r.Payload["page_id"].StringValue,
            (uint)r.Payload["chunk_index"].IntegerValue,
            r.Payload["chunk_text"].StringValue,
            r.Payload["heading_path"].StringValue,
            1f / (1f + (1f - r.Score))
        )).ToList();
    }

    public async Task DeletePage(string projectPath, string pageId)
    {
        ValidatePageId(pageId);
        var name = CollectionName(projectPath);
        var existing = await _client.ListCollectionsAsync();
        if (!existing.Any(c => c == name)) return;
        await _client.DeleteAsync(name, Conditions.MatchKeyword("page_id", pageId));
    }

    public async Task<ulong> CountChunks(string projectPath)
    {
        var name = CollectionName(projectPath);
        var existing = await _client.ListCollectionsAsync();
        if (!existing.Any(c => c == name)) return 0;
        var info = await _client.GetCollectionInfoAsync(name);
        return info.PointsCount;
    }

    public async Task DropCollection(string projectPath)
    {
        var name = CollectionName(projectPath);
        var existing = await _client.ListCollectionsAsync();
        if (existing.Any(c => c == name))
            await _client.DeleteCollectionAsync(name);
    }

    // ── Dept-scoped overloads (Phase 3) ──────────────────────────────────────

    public async Task UpsertChunks(Guid deptId, string projectPath, string pageId, ChunkUpsertInput[] chunks)
    {
        if (chunks.Length == 0) return;
        ValidatePageId(pageId);
        var dim = (uint)chunks[0].Embedding.Length;
        var collName = CollectionName(deptId, projectPath);
        var existing = await _client.ListCollectionsAsync();
        if (!existing.Any(c => c == collName))
            await _client.CreateCollectionAsync(collName, new VectorParams { Size = dim, Distance = Distance.Cosine });

        // Delete existing chunks for this page first
        await _client.DeleteAsync(collName, Conditions.MatchKeyword("page_id", pageId));

        var points = chunks.Select(c => new PointStruct
        {
            Id = Guid.NewGuid(),
            Vectors = c.Embedding,
            Payload =
            {
                ["chunk_id"] = $"{pageId}#{c.ChunkIndex}",
                ["page_id"] = pageId,
                ["chunk_index"] = (long)c.ChunkIndex,
                ["chunk_text"] = c.ChunkText,
                ["heading_path"] = c.HeadingPath,
            }
        }).ToList();

        await _client.UpsertAsync(collName, points);
    }

    public async Task<IReadOnlyList<ChunkSearchResult>> SearchChunks(
        Guid deptId, string projectPath, float[] queryEmbedding, int topK = 5)
    {
        var collName = CollectionName(deptId, projectPath);
        var existing = await _client.ListCollectionsAsync();
        if (!existing.Any(c => c == collName)) return [];

        var results = await _client.SearchAsync(
            collName,
            queryEmbedding,
            limit: (ulong)topK,
            payloadSelector: true);

        return results.Select(r => new ChunkSearchResult(
            r.Payload["chunk_id"].StringValue,
            r.Payload["page_id"].StringValue,
            (uint)r.Payload["chunk_index"].IntegerValue,
            r.Payload["chunk_text"].StringValue,
            r.Payload["heading_path"].StringValue,
            1f / (1f + (1f - r.Score))
        )).ToList();
    }

    public async Task DeletePage(Guid deptId, string projectPath, string pageId)
    {
        ValidatePageId(pageId);
        var collName = CollectionName(deptId, projectPath);
        var existing = await _client.ListCollectionsAsync();
        if (!existing.Any(c => c == collName)) return;
        await _client.DeleteAsync(collName, Conditions.MatchKeyword("page_id", pageId));
    }

    public async Task<ulong> CountChunks(Guid deptId, string projectPath)
    {
        var collName = CollectionName(deptId, projectPath);
        var existing = await _client.ListCollectionsAsync();
        if (!existing.Any(c => c == collName)) return 0;
        var info = await _client.GetCollectionInfoAsync(collName);
        return info.PointsCount;
    }

    public async Task DropCollection(Guid deptId, string projectPath)
    {
        var collName = CollectionName(deptId, projectPath);
        var existing = await _client.ListCollectionsAsync();
        if (existing.Any(c => c == collName))
            await _client.DeleteCollectionAsync(collName);
    }

    // Legacy v1 stubs — no-ops for frontend compatibility
    public Task<List<VectorSearchResult>> SearchLegacy(string projectPath, float[] queryEmbedding, int topK) =>
        Task.FromResult(new List<VectorSearchResult>());
    public Task<ulong> LegacyRowCount(string projectPath) => Task.FromResult(0UL);
    public Task DropLegacy(string projectPath) => Task.CompletedTask;

    private static void ValidatePageId(string pageId)
    {
        if (string.IsNullOrEmpty(pageId) || pageId.Length > 256)
            throw new ArgumentException("Invalid page_id: empty or too long");
        if (!pageId.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_' or '.'))
            throw new ArgumentException($"Invalid page_id: contains disallowed characters: {pageId}");
    }
}
