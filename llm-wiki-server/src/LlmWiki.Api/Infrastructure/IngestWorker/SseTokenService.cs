// llm-wiki-server/src/LlmWiki.Api/Infrastructure/IngestWorker/SseTokenService.cs
using System.Collections.Concurrent;
using System.Security.Cryptography;

namespace LlmWiki.Api.Infrastructure.IngestWorker;

public record SseTokenInfo(Guid UserId, Guid DeptId, DateTimeOffset ExpiresAt);

public class SseTokenService
{
    private readonly ConcurrentDictionary<string, SseTokenInfo> _tokens = new();
    private readonly TimeSpan _ttl = TimeSpan.FromMinutes(10);

    public (string Token, DateTimeOffset ExpiresAt) Issue(Guid userId, Guid deptId)
    {
        // 清理过期 token（机会性清理）
        var now = DateTimeOffset.UtcNow;
        foreach (var (k, v) in _tokens)
            if (v.ExpiresAt < now) _tokens.TryRemove(k, out _);

        var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
            .Replace('+', '-').Replace('/', '_').TrimEnd('=');
        var expiresAt = now.Add(_ttl);
        _tokens[token] = new SseTokenInfo(userId, deptId, expiresAt);
        return (token, expiresAt);
    }

    public SseTokenInfo? Validate(string token, Guid deptId)
    {
        if (!_tokens.TryGetValue(token, out var info)) return null;
        if (info.ExpiresAt < DateTimeOffset.UtcNow) { _tokens.TryRemove(token, out _); return null; }
        if (info.DeptId != deptId) return null;
        return info;
    }

    public void Revoke(Guid userId)
    {
        foreach (var (k, v) in _tokens)
            if (v.UserId == userId) _tokens.TryRemove(k, out _);
    }
}
