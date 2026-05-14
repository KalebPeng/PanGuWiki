using LlmWiki.Api.Infrastructure;
using LlmWiki.Api.Modules.Identity.Entities;
using LlmWiki.Api.Modules.Org.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace LlmWiki.Api.Modules.Identity;

[ApiController]
[Route("api/auth")]
public class AuthController(
    AppDbContext db,
    JwtService jwtService,
    PasswordService passwordService,
    ICurrentUser currentUser) : ControllerBase
{
    // ── Request / Response records ────────────────────────────────────────────

    public record RegisterRequest(string Email, string Password, string DisplayName);

    public record LoginRequest(string Email, string Password);

    public record AuthResponse(string AccessToken, UserDto User);

    public record AuthResponseWithRefresh(string AccessToken, string RefreshToken, UserDto User);

    public record RefreshRequest(string RefreshToken);

    public record UserDto(Guid Id, string Email, string DisplayName);

    public record MeResponse(
        Guid Id,
        string Email,
        string DisplayName,
        string? AvatarUrl,
        bool IsActive,
        DateTime CreatedAt);

    public record ErrorResponse(string Error);

    public record McpTokenRequest(Guid DeptId);

    public record McpTokenResponse(string McpToken, string DeptId, int ExpiresInDays);

    // ── POST /api/auth/register ───────────────────────────────────────────────

    [HttpPost("register")]
    public async Task<IActionResult> Register([FromBody] RegisterRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Email))
            return BadRequest(new ErrorResponse("Email is required."));

        if (string.IsNullOrWhiteSpace(request.Password) || request.Password.Length < 8)
            return BadRequest(new ErrorResponse("Password must be at least 8 characters."));

        if (string.IsNullOrWhiteSpace(request.DisplayName))
            return BadRequest(new ErrorResponse("Display name is required."));

        var emailLower = request.Email.Trim().ToLowerInvariant();

        var exists = await db.Users
            .AnyAsync(u => u.Email == emailLower);

        if (exists)
            return Conflict(new ErrorResponse("Email already registered"));

        var now = DateTime.UtcNow;
        var user = new AppUser
        {
            Email = emailLower,
            DisplayName = request.DisplayName.Trim(),
            PasswordHash = passwordService.Hash(request.Password),
            IsActive = true,
            CreatedAt = now,
            UpdatedAt = now,
        };

        db.Users.Add(user);
        await db.SaveChangesAsync();

        var accessToken = jwtService.GenerateAccessToken(user);
        var rawRefreshToken = JwtService.GenerateRefreshToken();

        var refreshTokenEntity = new RefreshToken
        {
            UserId = user.Id,
            Token = rawRefreshToken,
            ExpiresAt = DateTime.UtcNow.AddDays(30),
            CreatedAt = DateTime.UtcNow,
        };
        db.RefreshTokens.Add(refreshTokenEntity);
        await db.SaveChangesAsync();

        return CreatedAtAction(
            nameof(Me),
            new AuthResponseWithRefresh(
                accessToken,
                rawRefreshToken,
                new UserDto(user.Id, user.Email, user.DisplayName)));
    }

    // ── POST /api/auth/login ──────────────────────────────────────────────────

    [HttpPost("login")]
    public async Task<IActionResult> Login([FromBody] LoginRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Password))
            return BadRequest(new ErrorResponse("Password is required."));

        var emailLower = request.Email?.Trim().ToLowerInvariant() ?? string.Empty;

        var user = await db.Users
            .FirstOrDefaultAsync(u => u.Email == emailLower);

        if (user is null || !user.IsActive)
        {
            passwordService.Verify(request.Password, "$2a$12$dummydummydummydummyduuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuu");
            return Unauthorized(new ErrorResponse("Invalid credentials"));
        }

        if (!passwordService.Verify(request.Password, user.PasswordHash))
            return Unauthorized(new ErrorResponse("Invalid credentials"));

        var accessToken = jwtService.GenerateAccessToken(user);
        var rawRefreshToken = JwtService.GenerateRefreshToken();

        var refreshTokenEntity = new RefreshToken
        {
            UserId = user.Id,
            Token = rawRefreshToken,
            ExpiresAt = DateTime.UtcNow.AddDays(30),
            CreatedAt = DateTime.UtcNow,
        };
        db.RefreshTokens.Add(refreshTokenEntity);
        await db.SaveChangesAsync();

        return Ok(new AuthResponseWithRefresh(
            accessToken,
            rawRefreshToken,
            new UserDto(user.Id, user.Email, user.DisplayName)));
    }

    // ── POST /api/auth/refresh ────────────────────────────────────────────────

    [HttpPost("refresh")]
    public async Task<IActionResult> Refresh([FromBody] RefreshRequest request)
    {
        var now = DateTime.UtcNow;

        var existing = await db.RefreshTokens
            .FirstOrDefaultAsync(r =>
                r.Token == request.RefreshToken &&
                !r.IsRevoked &&
                r.ExpiresAt > now);

        if (existing is null)
            return Unauthorized(new ErrorResponse("Invalid or expired refresh token"));

        // Token rotation: revoke old token
        existing.IsRevoked = true;

        var user = await db.Users.FindAsync(existing.UserId);
        if (user is null || !user.IsActive)
            return Unauthorized(new ErrorResponse("Invalid or expired refresh token"));

        var newAccessToken = jwtService.GenerateAccessToken(user);
        var newRawRefreshToken = JwtService.GenerateRefreshToken();

        var newRefreshTokenEntity = new RefreshToken
        {
            UserId = user.Id,
            Token = newRawRefreshToken,
            ExpiresAt = now.AddDays(30),
            CreatedAt = now,
        };
        db.RefreshTokens.Add(newRefreshTokenEntity);
        await db.SaveChangesAsync();

        return Ok(new AuthResponseWithRefresh(
            newAccessToken,
            newRawRefreshToken,
            new UserDto(user.Id, user.Email, user.DisplayName)));
    }

    // ── GET /api/auth/me ──────────────────────────────────────────────────────

    [Authorize]
    [HttpGet("me")]
    public async Task<IActionResult> Me()
    {
        var user = await db.Users.FindAsync(currentUser.UserId);

        if (user is null)
            return NotFound();

        return Ok(new MeResponse(
            user.Id,
            user.Email,
            user.DisplayName,
            user.AvatarUrl,
            user.IsActive,
            user.CreatedAt));
    }

    // ── POST /api/auth/mcp-token ──────────────────────────────────────────────

    [Authorize]
    [HttpPost("mcp-token")]
    public async Task<IActionResult> IssueMcpToken([FromBody] McpTokenRequest request)
    {
        var member = await db.DepartmentMembers
            .FirstOrDefaultAsync(m =>
                m.UserId == currentUser.UserId &&
                m.DepartmentId == request.DeptId &&
                m.Role == "admin");

        if (member is null)
            return StatusCode(StatusCodes.Status403Forbidden,
                new ErrorResponse("You must be an admin of this department to generate an MCP token."));

        var user = await db.Users.FindAsync(currentUser.UserId);

        if (user is null)
            return NotFound(new ErrorResponse("User not found."));

        var mcpToken = jwtService.GenerateMcpToken(user, request.DeptId);

        return Ok(new McpTokenResponse(mcpToken, request.DeptId.ToString(), 365));
    }
}
