using LlmWiki.Api.Infrastructure;
using LlmWiki.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace LlmWiki.Api.Modules.Wiki;

// ── Request / Response records ────────────────────────────────────────────────

public record DeptFileWriteRequest(string Path, string Contents);

public record DeptFileExistsResponse(bool Exists);

// ── Controller ────────────────────────────────────────────────────────────────

[ApiController]
[Route("api/departments/{deptId:guid}/files")]
[Authorize]
public class DeptFileController(FileService fileService, ITenantContext tenant) : ControllerBase
{
    /// <summary>GET api/departments/{deptId}/files/list?path=xxx</summary>
    [HttpGet("list")]
    [RequireDeptRole]
    public async Task<IActionResult> List([FromQuery] string? path)
    {
        if (tenant.WikiProjectPath is null)
            return Forbid();

        string absolutePath;
        if (string.IsNullOrWhiteSpace(path))
        {
            absolutePath = tenant.WikiProjectPath;
        }
        else
        {
            var resolved = ResolveSafePath(path);
            if (resolved is null)
                return BadRequest(new { error = "Invalid path" });
            absolutePath = resolved;
        }

        try
        {
            var tree = await fileService.ListDirectory(absolutePath);
            return Ok(tree);
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    /// <summary>GET api/departments/{deptId}/files/read?path=xxx</summary>
    [HttpGet("read")]
    [RequireDeptRole]
    public async Task<IActionResult> Read([FromQuery] string? path)
    {
        if (tenant.WikiProjectPath is null)
            return Forbid();

        if (string.IsNullOrWhiteSpace(path))
            return BadRequest(new { error = "path query parameter is required" });

        var absolutePath = ResolveSafePath(path);
        if (absolutePath is null)
            return BadRequest(new { error = "Invalid path" });

        try
        {
            var contents = await fileService.ReadFile(absolutePath);
            return Ok(contents);
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    /// <summary>POST api/departments/{deptId}/files/write</summary>
    [HttpPost("write")]
    [RequireDeptRole]
    public async Task<IActionResult> Write([FromBody] DeptFileWriteRequest req)
    {
        if (tenant.WikiProjectPath is null)
            return Forbid();

        var absolutePath = ResolveSafePath(req.Path);
        if (absolutePath is null)
            return BadRequest(new { error = "Invalid path" });

        try
        {
            await fileService.WriteFile(absolutePath, req.Contents);
            return Ok();
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    /// <summary>DELETE api/departments/{deptId}/files?path=xxx</summary>
    [HttpDelete]
    [RequireDeptRole]
    public async Task<IActionResult> Delete([FromQuery] string? path)
    {
        if (tenant.WikiProjectPath is null)
            return Forbid();

        if (string.IsNullOrWhiteSpace(path))
            return BadRequest(new { error = "path query parameter is required" });

        var absolutePath = ResolveSafePath(path);
        if (absolutePath is null)
            return BadRequest(new { error = "Invalid path" });

        try
        {
            await fileService.DeleteFile(absolutePath);
            return NoContent();
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    /// <summary>GET api/departments/{deptId}/files/exists?path=xxx</summary>
    [HttpGet("exists")]
    [RequireDeptRole]
    public async Task<IActionResult> Exists([FromQuery] string? path)
    {
        if (tenant.WikiProjectPath is null)
            return Forbid();

        if (string.IsNullOrWhiteSpace(path))
            return BadRequest(new { error = "path query parameter is required" });

        var absolutePath = ResolveSafePath(path);
        if (absolutePath is null)
            return BadRequest(new { error = "Invalid path" });

        var exists = await fileService.FileExists(absolutePath);
        return Ok(new DeptFileExistsResponse(exists));
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private string? ResolveSafePath(string relativePath)
    {
        if (string.IsNullOrWhiteSpace(relativePath)) return null;
        var root = tenant.WikiProjectPath!;
        // 将相对路径与根目录拼接，规范化
        var full = Path.GetFullPath(Path.Combine(root, relativePath.TrimStart('/', '\\')));
        // 确保在根目录内（防止 ../ 穿越）
        // 末尾加路径分隔符，避免 /data/wiki 误匹配 /data/wiki-evil/...
        var rootWithSep = root.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
                              + Path.DirectorySeparatorChar;
        return full.StartsWith(rootWithSep, StringComparison.OrdinalIgnoreCase) ? full : null;
    }
}
