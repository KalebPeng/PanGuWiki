// llm-wiki-server/src/LlmWiki.Api/Modules/Wiki/LlmConfigController.cs
using LlmWiki.Api.Infrastructure;
using LlmWiki.Api.Modules.Wiki.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace LlmWiki.Api.Modules.Wiki;

public record UpsertLlmConfigRequest(
    string Provider,
    string Endpoint,
    string ApiKey,
    string Model,
    string? ApiMode,
    int MaxContextSize = 32000);

public record LlmConfigResponse(
    Guid Id,
    string Provider,
    string Endpoint,
    bool HasApiKey,
    string Model,
    string? ApiMode,
    int MaxContextSize,
    bool IsActive);

[ApiController]
[Authorize]
public class LlmConfigController(
    AppDbContext db,
    LlmConfigService configService,
    ICurrentUser currentUser) : ControllerBase
{
    private static LlmConfigResponse ToResponse(LlmConfig c) => new(
        c.Id, c.Provider, c.Endpoint,
        !string.IsNullOrEmpty(c.EncryptedApiKey),
        c.Model, c.ApiMode, c.MaxContextSize, c.IsActive);

    /// <summary>GET /api/llm-configs/me — current user's config</summary>
    [HttpGet("api/llm-configs/me")]
    public async Task<IActionResult> GetMine()
    {
        if (!currentUser.IsAuthenticated) return Unauthorized();
        var config = await db.LlmConfigs
            .Where(c => c.UserId == currentUser.UserId && c.IsActive)
            .FirstOrDefaultAsync();
        return config is null ? NotFound() : Ok(ToResponse(config));
    }

    /// <summary>PUT /api/llm-configs/me — create or update current user's config</summary>
    [HttpPut("api/llm-configs/me")]
    public async Task<IActionResult> UpsertMine([FromBody] UpsertLlmConfigRequest req)
    {
        if (!currentUser.IsAuthenticated) return Unauthorized();
        // Preserve existing encrypted key if the caller didn't supply a new one
        var existing = await db.LlmConfigs
            .Where(c => c.UserId == currentUser.UserId && c.IsActive)
            .FirstOrDefaultAsync();
        var preservedKey = string.IsNullOrEmpty(req.ApiKey)
            ? (existing?.EncryptedApiKey ?? "")
            : configService.EncryptIfNotEmpty(req.ApiKey);

        if (existing is not null)
            await db.LlmConfigs
                .Where(c => c.UserId == currentUser.UserId && c.IsActive)
                .ExecuteUpdateAsync(s => s.SetProperty(c => c.IsActive, false));

        var config = new LlmConfig
        {
            UserId = currentUser.UserId,
            Provider = req.Provider,
            Endpoint = req.Endpoint,
            EncryptedApiKey = preservedKey,
            Model = req.Model,
            ApiMode = req.ApiMode,
            MaxContextSize = req.MaxContextSize,
            IsActive = true,
        };
        db.LlmConfigs.Add(config);
        await db.SaveChangesAsync();
        return Ok(ToResponse(config));
    }

    /// <summary>GET /api/departments/{deptId}/llm-config</summary>
    [HttpGet("api/departments/{deptId:guid}/llm-config")]
    [RequireDeptRole]
    public async Task<IActionResult> GetDept(Guid deptId)
    {
        var config = await db.LlmConfigs
            .Where(c => c.DepartmentId == deptId && c.IsActive)
            .FirstOrDefaultAsync();
        return config is null ? NotFound() : Ok(ToResponse(config));
    }

    /// <summary>PUT /api/departments/{deptId}/llm-config — admin sets dept config</summary>
    [HttpPut("api/departments/{deptId:guid}/llm-config")]
    [RequireDeptRole]
    public async Task<IActionResult> UpsertDept(Guid deptId, [FromBody] UpsertLlmConfigRequest req)
    {
        var existing = await db.LlmConfigs
            .Where(c => c.DepartmentId == deptId && c.IsActive)
            .FirstOrDefaultAsync();
        var preservedKey = string.IsNullOrEmpty(req.ApiKey)
            ? (existing?.EncryptedApiKey ?? "")
            : configService.EncryptIfNotEmpty(req.ApiKey);

        if (existing is not null)
            await db.LlmConfigs
                .Where(c => c.DepartmentId == deptId && c.IsActive)
                .ExecuteUpdateAsync(s => s.SetProperty(c => c.IsActive, false));

        var config = new LlmConfig
        {
            DepartmentId = deptId,
            Provider = req.Provider,
            Endpoint = req.Endpoint,
            EncryptedApiKey = preservedKey,
            Model = req.Model,
            ApiMode = req.ApiMode,
            MaxContextSize = req.MaxContextSize,
            IsActive = true,
        };
        db.LlmConfigs.Add(config);
        await db.SaveChangesAsync();
        return Ok(ToResponse(config));
    }
}
