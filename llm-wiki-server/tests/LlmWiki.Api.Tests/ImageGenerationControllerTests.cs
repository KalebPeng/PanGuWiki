using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using LlmWiki.Api.Infrastructure;
using LlmWiki.Api.Modules.Identity;
using LlmWiki.Api.Modules.Identity.Entities;
using LlmWiki.Api.Modules.Org.Entities;
using LlmWiki.Api.Modules.Wiki.Entities;
using Microsoft.Extensions.DependencyInjection;
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

    [Fact]
    public async Task ConfigGet_NeverReturnsApiKey_AfterPutConfig()
    {
        await using var factory = new TestWebApplicationFactory();
        var (client, deptId, _) = await CreateAuthenticatedDepartmentClient(factory, "admin");

        var put = await client.PutAsJsonAsync($"/api/departments/{deptId}/image-generation/config", new
        {
            enabled = true,
            base_url = "https://relay.example.com",
            api_key = "sk-test-secret",
            model = "gpt-image-1",
            default_size = "1024x1024",
        });
        put.EnsureSuccessStatusCode();

        var get = await client.GetAsync($"/api/departments/{deptId}/image-generation/config");
        get.EnsureSuccessStatusCode();
        var json = await get.Content.ReadAsStringAsync();

        Assert.Contains("\"has_api_key\":true", json);
        Assert.DoesNotContain("sk-test-secret", json);
        Assert.DoesNotContain("\"api_key\":", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("encrypted", json, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task ConfigPut_PreservesApiKey_WhenDisabledThenReenabledWithBlankKey()
    {
        await using var factory = new TestWebApplicationFactory();
        var (client, deptId, _) = await CreateAuthenticatedDepartmentClient(factory, "admin");

        await PutConfig(client, deptId);

        var disable = await client.PutAsJsonAsync($"/api/departments/{deptId}/image-generation/config", new
        {
            enabled = false,
            base_url = "https://relay.example.com",
            api_key = "",
            model = "gpt-image-1",
            default_size = "1024x1024",
        });
        disable.EnsureSuccessStatusCode();

        var reenable = await client.PutAsJsonAsync($"/api/departments/{deptId}/image-generation/config", new
        {
            enabled = true,
            base_url = "https://relay.example.com",
            api_key = "",
            model = "gpt-image-1",
            default_size = "1024x1024",
        });
        reenable.EnsureSuccessStatusCode();

        var get = await client.GetAsync($"/api/departments/{deptId}/image-generation/config");
        get.EnsureSuccessStatusCode();
        var json = await get.Content.ReadAsStringAsync();
        Assert.Contains("\"has_api_key\":true", json);
    }

    [Fact]
    public async Task ConfigPut_AllowsSuperAdminWithoutDepartmentMembership()
    {
        await using var factory = new TestWebApplicationFactory();
        var (_, deptId, _) = await CreateAuthenticatedDepartmentClient(factory, "viewer", email: "member@example.com");
        var superAdminClient = await CreateAuthenticatedSuperAdminClient(factory, email: "super@example.com");

        var response = await superAdminClient.PutAsJsonAsync($"/api/departments/{deptId}/image-generation/config", new
        {
            enabled = true,
            base_url = "https://relay.example.com",
            api_key = "sk-test-secret",
            model = "gpt-image-1",
            default_size = "1024x1024",
        });

        response.EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task ConfigPut_AllowsSuperAdminWithNonAdminDepartmentMembership()
    {
        await using var factory = new TestWebApplicationFactory();
        var (superAdminClient, deptId, _) = await CreateAuthenticatedDepartmentClient(
            factory,
            "editor",
            email: "super-member@example.com",
            isSuperAdmin: true);

        var response = await superAdminClient.PutAsJsonAsync($"/api/departments/{deptId}/image-generation/config", new
        {
            enabled = true,
            base_url = "https://relay.example.com",
            api_key = "sk-test-secret",
            model = "gpt-image-1",
            default_size = "1024x1024",
        });

        response.EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task Generate_ReturnsBadRequest_WhenConfigMissing()
    {
        await using var factory = new TestWebApplicationFactory();
        var (client, deptId, _) = await CreateAuthenticatedDepartmentClient(factory, "viewer");

        var response = await client.PostAsJsonAsync($"/api/departments/{deptId}/images/generate", new
        {
            prompt = "A quiet product photo",
            n = 1,
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var json = await response.Content.ReadAsStringAsync();
        Assert.Contains("config", json, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Generate_ReturnsBadGateway_WhenRelayReturnsInvalidJson()
    {
        await using var factory = new TestWebApplicationFactory
        {
            OpenAiImagesHandler = new StubHttpMessageHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("not-json", Encoding.UTF8, "application/json"),
            }),
        };
        var (client, deptId, _) = await CreateAuthenticatedDepartmentClient(factory, "admin");
        await PutConfig(client, deptId);

        var response = await client.PostAsJsonAsync($"/api/departments/{deptId}/images/generate", new
        {
            prompt = "A quiet product photo",
            n = 1,
        });

        Assert.Equal(HttpStatusCode.BadGateway, response.StatusCode);
        var json = await response.Content.ReadAsStringAsync();
        Assert.Contains("relay", json, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Generate_ReturnsBadGateway_WhenRelayImageDownloadIsTooLarge()
    {
        await using var factory = new TestWebApplicationFactory
        {
            OpenAiImagesHandler = new StubHttpMessageHandler(request =>
            {
                if (request.Method == HttpMethod.Get)
                {
                    var content = new ByteArrayContent([]);
                    content.Headers.ContentLength = 10L * 1024 * 1024 + 1;
                    content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("image/png");
                    return new HttpResponseMessage(HttpStatusCode.OK) { Content = content };
                }

                return new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = JsonContent.Create(new
                    {
                        data = new[]
                        {
                            new { url = "https://relay.example.com/generated.png" },
                        },
                    }),
                };
            }),
        };
        var (client, deptId, _) = await CreateAuthenticatedDepartmentClient(factory, "admin");
        await PutConfig(client, deptId);

        var response = await client.PostAsJsonAsync($"/api/departments/{deptId}/images/generate", new
        {
            prompt = "A quiet product photo",
            n = 1,
        });

        Assert.Equal(HttpStatusCode.BadGateway, response.StatusCode);

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.Equal(0, await db.GeneratedImages.CountAsync(i => i.DepartmentId == deptId));
    }

    [Fact]
    public async Task Generate_WithB64Json_SavesFileUnderAssetRoot_AndListReturnsCurrentUserMetadata()
    {
        var expectedBytes = Encoding.UTF8.GetBytes("png-bytes");
        await using var factory = new TestWebApplicationFactory
        {
            OpenAiImagesHandler = new StubHttpMessageHandler(request =>
            {
                Assert.Equal(HttpMethod.Post, request.Method);
                Assert.Equal("https://relay.example.com/v1/images/generations", request.RequestUri?.ToString());
                Assert.Equal("Bearer", request.Headers.Authorization?.Scheme);
                Assert.Equal("sk-test-secret", request.Headers.Authorization?.Parameter);
                return new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = JsonContent.Create(new
                    {
                        data = new[]
                        {
                            new { b64_json = Convert.ToBase64String(expectedBytes) },
                        },
                    }),
                };
            }),
        };
        var (client, deptId, userId) = await CreateAuthenticatedDepartmentClient(factory, "admin");
        await PutConfig(client, deptId);

        var generate = await client.PostAsJsonAsync($"/api/departments/{deptId}/images/generate", new
        {
            prompt = "A quiet product photo",
            n = 1,
        });
        generate.EnsureSuccessStatusCode();
        var body = await ReadJson(generate);
        var image = body.RootElement.GetProperty("images")[0];
        var id = image.GetProperty("id").GetGuid();

        Assert.Equal("A quiet product photo", image.GetProperty("prompt").GetString());
        Assert.Equal("gpt-image-1", image.GetProperty("model").GetString());
        Assert.Equal("1024x1024", image.GetProperty("size").GetString());
        Assert.Contains($"/api/departments/{deptId}/images/{id}/content", image.GetProperty("content_url").GetString());

        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var saved = await db.GeneratedImages.SingleAsync(i => i.Id == id);
            Assert.Equal(deptId, saved.DepartmentId);
            Assert.Equal(userId, saved.UserId);
            Assert.StartsWith(factory.ImageAssetRoot, Path.GetFullPath(Path.Combine(factory.ImageAssetRoot, saved.FilePath)));
            Assert.True(File.Exists(Path.Combine(factory.ImageAssetRoot, saved.FilePath)));
        }

        var list = await client.GetAsync($"/api/departments/{deptId}/images");
        list.EnsureSuccessStatusCode();
        var listBody = await ReadJson(list);
        var listed = listBody.RootElement.GetProperty("images")[0];
        Assert.Equal(id, listed.GetProperty("id").GetGuid());
        Assert.Equal("A quiet product photo", listed.GetProperty("prompt").GetString());
    }

    [Fact]
    public async Task Generate_WithBaseUrlEndingInV1_DoesNotDuplicateVersionSegment()
    {
        var expectedBytes = Encoding.UTF8.GetBytes("png-bytes");
        await using var factory = new TestWebApplicationFactory
        {
            OpenAiImagesHandler = new StubHttpMessageHandler(request =>
            {
                Assert.Equal(HttpMethod.Post, request.Method);
                Assert.Equal("https://relay.example.com/v1/images/generations", request.RequestUri?.ToString());
                return new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = JsonContent.Create(new
                    {
                        data = new[]
                        {
                            new { b64_json = Convert.ToBase64String(expectedBytes) },
                        },
                    }),
                };
            }),
        };
        var (client, deptId, _) = await CreateAuthenticatedDepartmentClient(factory, "admin");
        await PutConfig(client, deptId, baseUrl: "https://relay.example.com/v1");

        var generate = await client.PostAsJsonAsync($"/api/departments/{deptId}/images/generate", new
        {
            prompt = "A quiet product photo",
            n = 1,
        });

        generate.EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task Generate_WithViduImageModel_SendsAspectRatioAndReferenceImages()
    {
        var expectedBytes = Encoding.UTF8.GetBytes("png-bytes");
        await using var factory = new TestWebApplicationFactory
        {
            OpenAiImagesHandler = new StubHttpMessageHandler(request =>
            {
                var body = request.Content!.ReadAsStringAsync().GetAwaiter().GetResult();
                using var json = JsonDocument.Parse(body);
                var root = json.RootElement;
                Assert.Equal("vidu/image-2", root.GetProperty("model").GetString());
                Assert.Equal("Same style, different background", root.GetProperty("prompt").GetString());
                Assert.Equal("1:1", root.GetProperty("size").GetString());
                Assert.False(root.TryGetProperty("n", out _));
                Assert.Equal("https://example.com/ref.jpg", root.GetProperty("images")[0].GetString());

                return new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = JsonContent.Create(new
                    {
                        data = new[]
                        {
                            new { b64_json = Convert.ToBase64String(expectedBytes) },
                        },
                    }),
                };
            }),
        };
        var (client, deptId, _) = await CreateAuthenticatedDepartmentClient(factory, "admin");
        await PutConfig(client, deptId, model: "vidu/image-2");

        var generate = await client.PostAsJsonAsync($"/api/departments/{deptId}/images/generate", new
        {
            prompt = "Same style, different background",
            size = "1024x1024",
            images = new[] { "https://example.com/ref.jpg" },
        });

        generate.EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task Generate_WithViduImageModel_SendsEmptyReferenceImages_WhenReferenceImagesMissing()
    {
        var expectedBytes = Encoding.UTF8.GetBytes("png-bytes");
        await using var factory = new TestWebApplicationFactory
        {
            OpenAiImagesHandler = new StubHttpMessageHandler(request =>
            {
                var body = request.Content!.ReadAsStringAsync().GetAwaiter().GetResult();
                using var json = JsonDocument.Parse(body);
                var root = json.RootElement;
                Assert.Equal("vidu/image-2", root.GetProperty("model").GetString());
                Assert.Equal("Same style, different background", root.GetProperty("prompt").GetString());
                Assert.Equal("1:1", root.GetProperty("size").GetString());
                Assert.False(root.TryGetProperty("n", out _));
                Assert.Equal(0, root.GetProperty("images").GetArrayLength());

                return new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = JsonContent.Create(new
                    {
                        data = new[]
                        {
                            new { b64_json = Convert.ToBase64String(expectedBytes) },
                        },
                    }),
                };
            }),
        };
        var (client, deptId, _) = await CreateAuthenticatedDepartmentClient(factory, "admin");
        await PutConfig(client, deptId, model: "vidu/image-2");

        var generate = await client.PostAsJsonAsync($"/api/departments/{deptId}/images/generate", new
        {
            prompt = "Same style, different background",
            size = "1024x1024",
        });

        generate.EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task ContentAndDelete_RejectAnotherUsersImage()
    {
        await using var factory = new TestWebApplicationFactory();
        var (ownerClient, deptId, ownerId) = await CreateAuthenticatedDepartmentClient(factory, "viewer", email: "owner@example.com");
        var (otherClient, _, _) = await CreateAuthenticatedDepartmentClient(factory, "viewer", deptId, email: "other@example.com");
        var imageId = Guid.NewGuid();

        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var storage = scope.ServiceProvider.GetRequiredService<LlmWiki.Api.Infrastructure.ImageAssets.ImageAssetStorage>();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var path = await storage.SaveAsync(deptId, ownerId, imageId, "image/png", Encoding.UTF8.GetBytes("owner-image"), CancellationToken.None);
            db.GeneratedImages.Add(new GeneratedImage
            {
                Id = imageId,
                DepartmentId = deptId,
                UserId = ownerId,
                Prompt = "Owner image",
                Model = "gpt-image-1",
                Size = "1024x1024",
                FilePath = path,
                MimeType = "image/png",
                CreatedAt = DateTime.UtcNow,
            });
            await db.SaveChangesAsync();
        }

        var content = await otherClient.GetAsync($"/api/departments/{deptId}/images/{imageId}/content");
        var delete = await otherClient.DeleteAsync($"/api/departments/{deptId}/images/{imageId}");
        Assert.Equal(HttpStatusCode.NotFound, content.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, delete.StatusCode);

        var ownerContent = await ownerClient.GetAsync($"/api/departments/{deptId}/images/{imageId}/content");
        ownerContent.EnsureSuccessStatusCode();
    }

    private static AppDbContext CreateDb(string name)
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(name)
            .Options;
        return new AppDbContext(options);
    }

    private static async Task PutConfig(
        HttpClient client,
        Guid deptId,
        string baseUrl = "https://relay.example.com",
        string model = "gpt-image-1")
    {
        var response = await client.PutAsJsonAsync($"/api/departments/{deptId}/image-generation/config", new
        {
            enabled = true,
            base_url = baseUrl,
            api_key = "sk-test-secret",
            model,
            default_size = "1024x1024",
        });
        response.EnsureSuccessStatusCode();
    }

    private static async Task<JsonDocument> ReadJson(HttpResponseMessage response)
    {
        var stream = await response.Content.ReadAsStreamAsync();
        return await JsonDocument.ParseAsync(stream);
    }

    private static async Task<(HttpClient Client, Guid DeptId, Guid UserId)> CreateAuthenticatedDepartmentClient(
        TestWebApplicationFactory factory,
        string role,
        Guid? deptId = null,
        string email = "user@example.com",
        bool isSuperAdmin = false)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var jwtService = scope.ServiceProvider.GetRequiredService<JwtService>();
        var now = DateTime.UtcNow;
        var user = new AppUser
        {
            Id = Guid.NewGuid(),
            Email = email,
            DisplayName = email,
            PasswordHash = "unused",
            IsActive = true,
            IsSuperAdmin = isSuperAdmin,
            CreatedAt = now,
            UpdatedAt = now,
        };
        var org = new Organization
        {
            Id = Guid.NewGuid(),
            Name = "Test Org",
            Slug = "test-org-" + Guid.NewGuid().ToString("N"),
            OwnerId = user.Id,
            CreatedAt = now,
        };
        var departmentId = deptId ?? Guid.NewGuid();
        var department = deptId.HasValue
            ? await db.Departments.FindAsync(departmentId)
            : null;
        if (department is null)
        {
            department = new Department
            {
                Id = departmentId,
                OrgId = org.Id,
                Org = org,
                Name = "Test Dept",
                Slug = "test-dept-" + Guid.NewGuid().ToString("N"),
                WikiProjectPath = Path.GetTempPath(),
                CreatedAt = now,
            };
            db.Organizations.Add(org);
            db.Departments.Add(department);
        }
        db.Users.Add(user);
        db.DepartmentMembers.Add(new DepartmentMember
        {
            Id = Guid.NewGuid(),
            DepartmentId = departmentId,
            UserId = user.Id,
            Role = role,
            JoinedAt = now,
        });
        await db.SaveChangesAsync();

        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", jwtService.GenerateAccessToken(user));
        return (client, departmentId, user.Id);
    }

    private static async Task<HttpClient> CreateAuthenticatedSuperAdminClient(
        TestWebApplicationFactory factory,
        string email = "super@example.com")
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var jwtService = scope.ServiceProvider.GetRequiredService<JwtService>();
        var now = DateTime.UtcNow;
        var user = new AppUser
        {
            Id = Guid.NewGuid(),
            Email = email,
            DisplayName = email,
            PasswordHash = "unused",
            IsActive = true,
            IsSuperAdmin = true,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();

        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", jwtService.GenerateAccessToken(user));
        return client;
    }

    private sealed class StubHttpMessageHandler(Func<HttpRequestMessage, HttpResponseMessage> responder) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(responder(request));
    }
}
