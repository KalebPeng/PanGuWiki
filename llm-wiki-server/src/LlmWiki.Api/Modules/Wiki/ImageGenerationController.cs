using LlmWiki.Api.Infrastructure;
using LlmWiki.Api.Infrastructure.ImageAssets;
using LlmWiki.Api.Infrastructure.ImageGeneration;
using LlmWiki.Api.Modules.Wiki.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Text.Json.Serialization;

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

public record GenerateImagesRequest(
    string Prompt,
    string? Model,
    string? Size,
    int? N,
    IReadOnlyList<string>? Images,
    [property: JsonPropertyName("image_asset_ids")]
    IReadOnlyList<Guid>? ImageAssetIds);

public class GenerateImagesFormRequest
{
    public string Prompt { get; set; } = string.Empty;
    public string? Model { get; set; }
    public string? Size { get; set; }
    public int? N { get; set; }
    [FromForm(Name = "image_asset_ids")]
    public List<Guid> ImageAssetIds { get; set; } = [];
    public List<IFormFile> Images { get; set; } = [];
}

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
    private const long MaxReferenceImageBytes = 10L * 1024 * 1024;

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
    [Consumes("application/json")]
    [RequireDeptRole]
    public async Task<IActionResult> Generate(Guid deptId, [FromBody] GenerateImagesRequest request, CancellationToken ct)
    {
        var imageInputs = request.Images?
            .Where(url => !string.IsNullOrWhiteSpace(url))
            .Select(url => url.Trim())
            .ToList() ?? [];

        IReadOnlyList<string> assetInputs;
        try
        {
            assetInputs = await LoadReferenceAssetInputs(deptId, request.ImageAssetIds ?? [], ct);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
        imageInputs.AddRange(assetInputs);

        return await GenerateCore(deptId, request.Prompt, request.Model, request.Size, request.N, imageInputs, ct);
    }

    [HttpPost("api/departments/{deptId:guid}/images/generate")]
    [Consumes("multipart/form-data")]
    [RequireDeptRole]
    public async Task<IActionResult> GenerateFromForm(Guid deptId, [FromForm] GenerateImagesFormRequest request, CancellationToken ct)
    {
        var imageInputs = new List<string>();
        foreach (var file in request.Images)
        {
            if (file.Length == 0) continue;
            if (file.Length > MaxReferenceImageBytes)
            {
                return BadRequest(new { error = "Reference image is too large." });
            }

            var contentType = string.IsNullOrWhiteSpace(file.ContentType) ? "application/octet-stream" : file.ContentType;
            if (!contentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
            {
                return BadRequest(new { error = "Reference files must be images." });
            }

            await using var stream = file.OpenReadStream();
            using var buffer = new MemoryStream();
            await stream.CopyToAsync(buffer, ct);
            imageInputs.Add($"data:{contentType};base64,{Convert.ToBase64String(buffer.ToArray())}");
        }

        IReadOnlyList<string> assetInputs;
        try
        {
            assetInputs = await LoadReferenceAssetInputs(deptId, request.ImageAssetIds, ct);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
        imageInputs.AddRange(assetInputs);

        return await GenerateCore(deptId, request.Prompt, request.Model, request.Size, request.N, imageInputs, ct);
    }

    private async Task<IReadOnlyList<string>> LoadReferenceAssetInputs(
        Guid deptId,
        IReadOnlyList<Guid> imageAssetIds,
        CancellationToken ct)
    {
        var ids = imageAssetIds.Where(id => id != Guid.Empty).Distinct().ToList();
        if (ids.Count == 0)
        {
            return [];
        }

        var assets = await db.GeneratedImages
            .Where(i => i.DepartmentId == deptId && i.UserId == currentUser.UserId && ids.Contains(i.Id))
            .ToListAsync(ct);
        if (assets.Count != ids.Count)
        {
            throw new InvalidOperationException("Reference image asset was not found.");
        }

        var inputs = new List<string>();
        foreach (var asset in assets)
        {
            var (bytes, mimeType) = await assetStorage.ReadAsync(asset.FilePath, ct);
            inputs.Add($"data:{mimeType};base64,{Convert.ToBase64String(bytes)}");
        }

        return inputs;
    }

    private async Task<IActionResult> GenerateCore(
        Guid deptId,
        string promptValue,
        string? modelValue,
        string? sizeValue,
        int? nValue,
        IReadOnlyList<string> imageInputs,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(promptValue))
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

        var n = Math.Clamp(nValue ?? 1, 1, 4);
        var model = string.IsNullOrWhiteSpace(modelValue) ? config.Model : modelValue.Trim();
        var size = string.IsNullOrWhiteSpace(sizeValue) ? config.DefaultSize : sizeValue.Trim();
        var prompt = promptValue.Trim();
        var apiKey = configService.DecryptIfNotEmpty(config.EncryptedApiKey);

        IReadOnlyList<GeneratedImagePayload> payloads;
        try
        {
            payloads = await imagesClient.GenerateAsync(config.BaseUrl, apiKey, model, prompt, size, n, imageInputs, ct);
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
