using LlmWiki.Api.Infrastructure;
using LlmWiki.Api.Modules.Wiki.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace LlmWiki.Api.Modules.Wiki;

public record UpsertEmbeddingConfigRequest(
    string Provider,
    string Endpoint,
    string? ApiKey,
    string Model,
    int Dimensions = 1536);

public record EmbeddingConfigResponse(
    Guid Id,
    string Provider,
    string Endpoint,
    bool HasApiKey,
    string Model,
    int Dimensions,
    bool IsActive,
    DateTime CreatedAt);

[ApiController]
[Authorize]
public class EmbeddingConfigController(
    AppDbContext db,
    LlmConfigService configService,
    ICurrentUser currentUser) : ControllerBase
{
    private static EmbeddingConfigResponse ToResponse(EmbeddingConfig c) => new(
        c.Id, c.Provider, c.Endpoint,
        !string.IsNullOrEmpty(c.EncryptedApiKey),
        c.Model, c.Dimensions, c.IsActive, c.CreatedAt);

    /// <summary>GET /api/embedding-configs/me — current user's config</summary>
    [HttpGet("api/embedding-configs/me")]
    public async Task<IActionResult> GetMine()
    {
        if (!currentUser.IsAuthenticated) return Unauthorized();
        var config = await db.EmbeddingConfigs
            .Where(c => c.UserId == currentUser.UserId && c.IsActive)
            .FirstOrDefaultAsync();
        return config is null ? NotFound() : Ok(ToResponse(config));
    }

    /// <summary>PUT /api/embedding-configs/me — create or update current user's config</summary>
    [HttpPut("api/embedding-configs/me")]
    public async Task<IActionResult> UpsertMine([FromBody] UpsertEmbeddingConfigRequest req)
    {
        if (!currentUser.IsAuthenticated) return Unauthorized();
        // Preserve existing encrypted key if the caller didn't supply a new one
        var existing = await db.EmbeddingConfigs
            .Where(c => c.UserId == currentUser.UserId && c.IsActive)
            .FirstOrDefaultAsync();
        var preservedKey = string.IsNullOrEmpty(req.ApiKey)
            ? (existing?.EncryptedApiKey ?? "")
            : configService.EncryptIfNotEmpty(req.ApiKey);

        if (existing is not null)
            await db.EmbeddingConfigs
                .Where(c => c.UserId == currentUser.UserId && c.IsActive)
                .ExecuteUpdateAsync(s => s.SetProperty(c => c.IsActive, false));

        var config = new EmbeddingConfig
        {
            Id = Guid.NewGuid(),
            UserId = currentUser.UserId,
            Provider = req.Provider,
            Endpoint = req.Endpoint,
            EncryptedApiKey = preservedKey,
            Model = req.Model,
            Dimensions = req.Dimensions,
            IsActive = true,
            CreatedAt = DateTime.UtcNow,
        };
        db.EmbeddingConfigs.Add(config);
        await db.SaveChangesAsync();
        return Ok(ToResponse(config));
    }

    /// <summary>GET /api/departments/{deptId}/embedding-config</summary>
    [HttpGet("api/departments/{deptId:guid}/embedding-config")]
    [RequireDeptRole]
    public async Task<IActionResult> GetDept(Guid deptId)
    {
        var config = await db.EmbeddingConfigs
            .Where(c => c.DepartmentId == deptId && c.IsActive)
            .FirstOrDefaultAsync();
        return config is null ? NotFound() : Ok(ToResponse(config));
    }

    /// <summary>PUT /api/departments/{deptId}/embedding-config — admin sets dept config</summary>
    [HttpPut("api/departments/{deptId:guid}/embedding-config")]
    [RequireDeptRole]
    public async Task<IActionResult> UpsertDept(Guid deptId, [FromBody] UpsertEmbeddingConfigRequest req)
    {
        var existing = await db.EmbeddingConfigs
            .Where(c => c.DepartmentId == deptId && c.IsActive)
            .FirstOrDefaultAsync();
        var preservedKey = string.IsNullOrEmpty(req.ApiKey)
            ? (existing?.EncryptedApiKey ?? "")
            : configService.EncryptIfNotEmpty(req.ApiKey);

        if (existing is not null)
            await db.EmbeddingConfigs
                .Where(c => c.DepartmentId == deptId && c.IsActive)
                .ExecuteUpdateAsync(s => s.SetProperty(c => c.IsActive, false));

        var config = new EmbeddingConfig
        {
            Id = Guid.NewGuid(),
            DepartmentId = deptId,
            Provider = req.Provider,
            Endpoint = req.Endpoint,
            EncryptedApiKey = preservedKey,
            Model = req.Model,
            Dimensions = req.Dimensions,
            IsActive = true,
            CreatedAt = DateTime.UtcNow,
        };
        db.EmbeddingConfigs.Add(config);
        await db.SaveChangesAsync();
        return Ok(ToResponse(config));
    }
}
