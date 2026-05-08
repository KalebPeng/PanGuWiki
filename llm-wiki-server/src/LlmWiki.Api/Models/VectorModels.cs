namespace LlmWiki.Api.Models;

public record VectorSearchResult(string PageId, float Score);

public record ChunkSearchResult(
    string ChunkId, string PageId, uint ChunkIndex,
    string ChunkText, string HeadingPath, float Score);

public record ChunkUpsertInput(
    uint ChunkIndex, string ChunkText, string HeadingPath, float[] Embedding);

public record VectorUpsertRequest(string ProjectPath, string PageId, float[] Embedding);
public record VectorSearchRequest(string ProjectPath, float[] QueryEmbedding, int TopK);
public record ChunkUpsertRequest(string ProjectPath, string PageId, ChunkUpsertInput[] Chunks);
public record ChunkSearchRequest(string ProjectPath, float[] QueryEmbedding, int TopK);
