using System.Text.RegularExpressions;

namespace LlmWiki.Api.Infrastructure.IngestWorker;

public record TextChunk(string HeadingPath, string Text, int Index);

public static class TextChunker
{
    private const int MaxChunkChars = 2000;
    private static readonly Regex HeadingRegex =
        new(@"^#{1,3}\s+(.+)$", RegexOptions.Multiline | RegexOptions.Compiled);

    public static IReadOnlyList<TextChunk> ChunkMarkdown(string markdown)
    {
        if (string.IsNullOrWhiteSpace(markdown)) return [];

        var chunks = new List<TextChunk>();
        int index = 0;

        foreach (var (heading, body) in SplitByHeadings(markdown))
        {
            if (string.IsNullOrWhiteSpace(body)) continue;

            var paragraphs = body.Split(
                ["\n\n", "\r\n\r\n"], StringSplitOptions.RemoveEmptyEntries);

            var current = "";
            foreach (var para in paragraphs)
            {
                var trimmed = para.Trim();
                if (trimmed.Length == 0) continue;

                if (current.Length > 0 && current.Length + trimmed.Length + 2 > MaxChunkChars)
                {
                    chunks.Add(new TextChunk(heading, current.Trim(), index++));
                    current = "";
                }
                current = current.Length > 0 ? current + "\n\n" + trimmed : trimmed;
            }
            if (current.Trim().Length > 0)
                chunks.Add(new TextChunk(heading, current.Trim(), index++));
        }

        return chunks;
    }

    private static IReadOnlyList<(string Heading, string Body)> SplitByHeadings(string text)
    {
        var result = new List<(string, string)>();
        var matches = HeadingRegex.Matches(text);

        if (matches.Count == 0)
        {
            result.Add(("", text));
            return result;
        }

        if (matches[0].Index > 0)
        {
            var pre = text[..matches[0].Index].Trim();
            if (pre.Length > 0) result.Add(("", pre));
        }

        for (int i = 0; i < matches.Count; i++)
        {
            var m = matches[i];
            var heading = m.Groups[1].Value.Trim();
            var start = m.Index + m.Length;
            var end = i + 1 < matches.Count ? matches[i + 1].Index : text.Length;
            var body = text[start..end].Trim();
            result.Add((heading, body));
        }

        return result;
    }
}
