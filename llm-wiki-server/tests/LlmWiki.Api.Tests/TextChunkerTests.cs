using LlmWiki.Api.Infrastructure.IngestWorker;

namespace LlmWiki.Api.Tests;

public class TextChunkerTests
{
    [Fact]
    public void ChunkMarkdown_EmptyInput_ReturnsEmpty()
        => Assert.Empty(TextChunker.ChunkMarkdown(""));

    [Fact]
    public void ChunkMarkdown_WhitespaceOnly_ReturnsEmpty()
        => Assert.Empty(TextChunker.ChunkMarkdown("   \n\n  "));

    [Fact]
    public void ChunkMarkdown_NoHeadings_ReturnsSingleChunk()
    {
        var chunks = TextChunker.ChunkMarkdown("Some content.");
        Assert.Single(chunks);
        Assert.Equal("", chunks[0].HeadingPath);
        Assert.Equal("Some content.", chunks[0].Text);
        Assert.Equal(0, chunks[0].Index);
    }

    [Fact]
    public void ChunkMarkdown_WithHeadings_SplitsIntoSections()
    {
        var md = "## Introduction\n\nThis is intro.\n\n## Methods\n\nThis is methods.";
        var chunks = TextChunker.ChunkMarkdown(md);
        Assert.Equal(2, chunks.Count);
        Assert.Equal("Introduction", chunks[0].HeadingPath);
        Assert.Contains("intro", chunks[0].Text);
        Assert.Equal("Methods", chunks[1].HeadingPath);
        Assert.Contains("methods", chunks[1].Text);
        Assert.Equal(0, chunks[0].Index);
        Assert.Equal(1, chunks[1].Index);
    }

    [Fact]
    public void ChunkMarkdown_LongSection_SplitsByParagraph()
    {
        var para = new string('x', 800);
        // Three 800-char paragraphs in one section → must produce >1 chunk
        var md = $"## Big\n\n{para}\n\n{para}\n\n{para}";
        var chunks = TextChunker.ChunkMarkdown(md);
        Assert.True(chunks.Count > 1, $"Expected >1 chunk, got {chunks.Count}");
        Assert.All(chunks, c => Assert.Equal("Big", c.HeadingPath));
    }

    [Fact]
    public void ChunkMarkdown_AllChunksHaveSequentialIndexes()
    {
        var md = "## A\n\nContent A.\n\n## B\n\nContent B.\n\n## C\n\nContent C.";
        var chunks = TextChunker.ChunkMarkdown(md);
        for (int i = 0; i < chunks.Count; i++)
            Assert.Equal(i, chunks[i].Index);
    }

    [Fact]
    public void ChunkMarkdown_PreHeadingContent_UsesEmptyHeading()
    {
        var md = "Preamble text.\n\n## Section\n\nSection body.";
        var chunks = TextChunker.ChunkMarkdown(md);
        Assert.Equal(2, chunks.Count);
        Assert.Equal("", chunks[0].HeadingPath);
        Assert.Equal("Section", chunks[1].HeadingPath);
    }
}
