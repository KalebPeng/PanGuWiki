namespace LlmWiki.Api.Infrastructure;

public interface ICurrentUser
{
    Guid UserId { get; }
    string Email { get; }
    bool IsAuthenticated { get; }
}
