using LlmWiki.Api.Infrastructure;
using LlmWiki.Api.Infrastructure.ImageAssets;
using LlmWiki.Api.Infrastructure.ImageGeneration;
using LlmWiki.Api.Modules.Wiki.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace LlmWiki.Api.Modules.Wiki;

public record UpsertImageGenerationConfigRequest(
    bool Enabled,
    string BaseUrl,
    string? ApiKey,
    string Model,
    string DefaultSize);

public record ImageGenerationConfigResponse(
    Guid Id,
    bool Enabled,
    string BaseUrl,
    bool HasApiKey,
    string Model,
    string DefaultSize);

public record GenerateImagesRequest(string Prompt, string? Model, string? Size, int? N);

public record GeneratedImageResponse(
    Guid Id,
    string Prompt,
    string Model,
    string Size,
    DateTime CreatedAt,
    string ContentUrl,
    string MimeType,
    string? SourceUrl);

public record GeneratedImagesResponse(IReadOnlyList<GeneratedImageResponse> Images);

[ApiController]
[Authorize]
public class ImageGenerationController(
    AppDbContext db,
    LlmConfigService configService,
    ICurrentUser currentUser,
    OpenAiImagesClient imagesClient,
    ImageAssetStorage assetStorage) : ControllerBase
{
    [HttpGet("api/departments/{deptId:guid}/image-generation/config")]
    [RequireDeptRole]
    public async Task<IActionResult> GetConfig(Guid deptId, CancellationToken ct)
    {
        var config = await db.ImageGenerationConfigs
            .Where(c => c.DepartmentId == deptId && c.IsActive)
            .FirstOrDefaultAsync(ct);

        return config is null ? NotFound() : Ok(ToConfigResponse(config));
    }

    [HttpPut("api/departments/{deptId:guid}/image-generation/config")]
    [RequireDeptRole("admin")]
    public async Task<IActionResult> UpsertConfig(Guid deptId, [FromBody] UpsertImageGenerationConfigRequest request, CancellationToken ct)
    {
        var existing = await db.ImageGenerationConfigs
            .Where(c => c.DepartmentId == deptId)
            .OrderByDescending(c => c.IsActive)
            .ThenByDescending(c => c.UpdatedAt)
            .FirstOrDefaultAsync(ct);
        var preservedKey = string.IsNullOrEmpty(request.ApiKey)
            ? existing?.EncryptedApiKey ?? string.Empty
            : configService.EncryptIfNotEmpty(request.ApiKey);

        var now = DateTime.UtcNow;
        var config = existing ?? new ImageGenerationConfig
        {
            Id = Guid.NewGuid(),
            DepartmentId = deptId,
            CreatedAt = now,
        };

        config.BaseUrl = request.BaseUrl;
        config.EncryptedApiKey = preservedKey;
        config.Model = request.Model;
        config.DefaultSize = request.DefaultSize;
        config.IsActive = request.Enabled;
        config.UpdatedAt = now;

        if (existing is null)
        {
            db.ImageGenerationConfigs.Add(config);
        }

        await db.SaveChangesAsync(ct);
        return Ok(ToConfigResponse(config));
    }

    [HttpPost("api/departments/{deptId:guid}/images/generate")]
    [RequireDeptRole]
    public async Task<IActionResult> Generate(Guid deptId, [FromBody] GenerateImagesRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Prompt))
        {
            return BadRequest(new { error = "Prompt is required." });
        }

        var config = await db.ImageGenerationConfigs
            .Where(c => c.DepartmentId == deptId && c.IsActive)
            .FirstOrDefaultAsync(ct);
        if (config is null)
        {
            return BadRequest(new { error = "Image generation config is missing or disabled." });
        }

        if (string.IsNullOrEmpty(config.EncryptedApiKey))
        {
            return BadRequest(new { error = "Image generation API key is not configured." });
        }

        var n = Math.Clamp(request.N ?? 1, 1, 4);
        var model = string.IsNullOrWhiteSpace(request.Model) ? config.Model : request.Model.Trim();
        var size = string.IsNullOrWhiteSpace(request.Size) ? config.DefaultSize : request.Size.Trim();
        var prompt = request.Prompt.Trim();
        var apiKey = configService.DecryptIfNotEmpty(config.EncryptedApiKey);

        IReadOnlyList<GeneratedImagePayload> payloads;
        try
        {
            payloads = await imagesClient.GenerateAsync(config.BaseUrl, apiKey, model, prompt, size, n, ct);
        }
        catch (ImageGenerationRelayException ex)
        {
            return StatusCode(StatusCodes.Status502BadGateway, new { error = ex.Message });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { error = ex.Message });
        }

        var now = DateTime.UtcNow;
        var images = new List<GeneratedImage>();
        foreach (var payload in payloads)
        {
            var imageId = Guid.NewGuid();
            var path = await assetStorage.SaveAsync(deptId, currentUser.UserId, imageId, payload.MimeType, payload.Bytes, ct);
            images.Add(new GeneratedImage
            {
                Id = imageId,
                DepartmentId = deptId,
                UserId = currentUser.UserId,
                Prompt = prompt,
                Model = model,
                Size = size,
                FilePath = path,
                MimeType = payload.MimeType,
                SourceUrl = payload.SourceUrl,
                CreatedAt = now,
            });
        }

        db.GeneratedImages.AddRange(images);
        await db.SaveChangesAsync(ct);

        return Ok(new GeneratedImagesResponse(images.Select(i => ToImageResponse(deptId, i)).ToList()));
    }

    [HttpGet("api/departments/{deptId:guid}/images")]
    [RequireDeptRole]
    public async Task<IActionResult> List(Guid deptId, CancellationToken ct)
    {
        var images = await db.GeneratedImages
            .Where(i => i.DepartmentId == deptId && i.UserId == currentUser.UserId)
            .OrderByDescending(i => i.CreatedAt)
            .ToListAsync(ct);

        return Ok(new GeneratedImagesResponse(images.Select(i => ToImageResponse(deptId, i)).ToList()));
    }

    [HttpGet("api/departments/{deptId:guid}/images/{id:guid}/content")]
    [RequireDeptRole]
    public async Task<IActionResult> Content(Guid deptId, Guid id, CancellationToken ct)
    {
        var image = await db.GeneratedImages
            .Where(i => i.DepartmentId == deptId && i.UserId == currentUser.UserId && i.Id == id)
            .FirstOrDefaultAsync(ct);
        if (image is null)
        {
            return NotFound();
        }

        var asset = await assetStorage.ReadAsync(image.FilePath, ct);
        return File(asset.Bytes, asset.MimeType);
    }

    [HttpDelete("api/departments/{deptId:guid}/images/{id:guid}")]
    [RequireDeptRole]
    public async Task<IActionResult> Delete(Guid deptId, Guid id, CancellationToken ct)
    {
        var image = await db.GeneratedImages
            .Where(i => i.DepartmentId == deptId && i.UserId == currentUser.UserId && i.Id == id)
            .FirstOrDefaultAsync(ct);
        if (image is null)
        {
            return NotFound();
        }

        await assetStorage.DeleteAsync(image.FilePath, ct);
        db.GeneratedImages.Remove(image);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    private static ImageGenerationConfigResponse ToConfigResponse(ImageGenerationConfig config) => new(
        config.Id,
        config.IsActive,
        config.BaseUrl,
        !string.IsNullOrEmpty(config.EncryptedApiKey),
        config.Model,
        config.DefaultSize);

    private GeneratedImageResponse ToImageResponse(Guid deptId, GeneratedImage image) => new(
        image.Id,
        image.Prompt,
        image.Model,
        image.Size,
        image.CreatedAt,
        $"/api/departments/{deptId}/images/{image.Id}/content",
        image.MimeType,
        image.SourceUrl);
}
