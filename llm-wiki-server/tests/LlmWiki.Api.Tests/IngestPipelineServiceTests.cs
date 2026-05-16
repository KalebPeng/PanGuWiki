using LlmWiki.Api.Infrastructure.IngestWorker;

namespace LlmWiki.Api.Tests;

public class ParseFileBlocksTests
{
    [Fact]
    public void ParseFileBlocks_SingleBlock_ExtractsCorrectly()
    {
        var text = "---FILE: wiki/concepts/foo.md---\nHello\n---END FILE---";
        var result = IngestPipelineService.ParseFileBlocks(text);
        Assert.Single(result.Blocks);
        Assert.Equal("wiki/concepts/foo.md", result.Blocks[0].Path);
        Assert.Equal("Hello", result.Blocks[0].Content.Trim());
    }

    [Fact]
    public void ParseFileBlocks_UnclosedBlock_ReturnsWarning()
    {
        var text = "---FILE: wiki/concepts/foo.md---\nHello";
        var result = IngestPipelineService.ParseFileBlocks(text);
        Assert.Empty(result.Blocks);
        Assert.Single(result.Warnings);
    }

    [Fact]
    public void ParseFileBlocks_PathTraversal_Rejected()
    {
        var text = "---FILE: ../../../etc/passwd---\nbad\n---END FILE---";
        var result = IngestPipelineService.ParseFileBlocks(text);
        Assert.Empty(result.Blocks);
        Assert.Single(result.Warnings);
    }

    [Fact]
    public void ParseFileBlocks_NotUnderWiki_Rejected()
    {
        var text = "---FILE: raw/bad.md---\nbad\n---END FILE---";
        var result = IngestPipelineService.ParseFileBlocks(text);
        Assert.Empty(result.Blocks);
    }

    [Fact]
    public void ParseFileBlocks_EndFileInsideFence_NotClosedEarly()
    {
        var text = "---FILE: wiki/concepts/foo.md---\n```\n---END FILE---\n```\n---END FILE---";
        var result = IngestPipelineService.ParseFileBlocks(text);
        Assert.Single(result.Blocks);
        // content should contain the ---END FILE--- inside the fence
        Assert.Contains("---END FILE---", result.Blocks[0].Content);
    }

    [Fact]
    public void ParseFileBlocks_CrlfLineEndings_Handled()
    {
        var text = "---FILE: wiki/concepts/foo.md---\r\nHello\r\n---END FILE---";
        var result = IngestPipelineService.ParseFileBlocks(text);
        Assert.Single(result.Blocks);
    }
}
