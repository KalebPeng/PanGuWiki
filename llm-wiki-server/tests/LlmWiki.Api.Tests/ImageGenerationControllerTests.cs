using LlmWiki.Api.Infrastructure;
using LlmWiki.Api.Modules.Wiki.Entities;
using Microsoft.EntityFrameworkCore;

namespace LlmWiki.Api.Tests;

[Trait("ClassName", "LlmWiki.Api.Tests.ImageGenerationControllerTests")]
public class ImageGenerationControllerTests
{
    [Fact]
    public async Task AppDbContext_PersistsImageGenerationConfigAndGeneratedImage()
    {
        await using var db = CreateDb(nameof(AppDbContext_PersistsImageGenerationConfigAndGeneratedImage));
        var deptId = Guid.NewGuid();
        var userId = Guid.NewGuid();

        db.ImageGenerationConfigs.Add(new ImageGenerationConfig
        {
            Id = Guid.NewGuid(),
            DepartmentId = deptId,
            BaseUrl = "https://relay.example.com",
            EncryptedApiKey = "encrypted",
            Model = "gpt-image-1",
            DefaultSize = "1024x1024",
            IsActive = true,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        });
        db.GeneratedImages.Add(new GeneratedImage
        {
            Id = Guid.NewGuid(),
            DepartmentId = deptId,
            UserId = userId,
            Prompt = "A quiet product photo",
            Model = "gpt-image-1",
            Size = "1024x1024",
            FilePath = "dept/users/user/2026/06/image.png",
            MimeType = "image/png",
            CreatedAt = DateTime.UtcNow,
        });

        await db.SaveChangesAsync();

        Assert.Equal(1, await db.ImageGenerationConfigs.CountAsync(c => c.DepartmentId == deptId));
        Assert.Equal(1, await db.GeneratedImages.CountAsync(i => i.DepartmentId == deptId && i.UserId == userId));
    }

    private static AppDbContext CreateDb(string name)
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(name)
            .Options;
        return new AppDbContext(options);
    }
}
