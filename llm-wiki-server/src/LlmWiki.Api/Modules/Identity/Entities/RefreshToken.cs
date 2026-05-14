namespace LlmWiki.Api.Modules.Identity.Entities;

public class RefreshToken
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }        // FK → AppUser.Id
    public string Token { get; set; } = ""; // 64字节随机十六进制，唯一
    public DateTime ExpiresAt { get; set; } // 30天后过期
    public bool IsRevoked { get; set; } = false;
    public DateTime CreatedAt { get; set; }
}
