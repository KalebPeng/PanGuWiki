using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace LlmWiki.Api.Services;

public record DetectResult(bool Installed, string? Version, string? Path, string? Error);

public record ClaudeMessage(
    [property: JsonPropertyName("role")] string Role,
    [property: JsonPropertyName("content")] string Content);

public class ClaudeCliService
{
    private readonly ConcurrentDictionary<string, Process> _processes = new();

    public async Task<DetectResult> Detect()
    {
        var claudePath = FindClaude();
        if (claudePath is null)
            return new DetectResult(false, null, null, "`claude` not found on PATH");

        try
        {
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(3));
            var psi = new ProcessStartInfo(claudePath, "--version")
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false
            };
            using var proc = Process.Start(psi)!;
            await proc.WaitForExitAsync(cts.Token);
            if (proc.ExitCode == 0)
            {
                var version = (await proc.StandardOutput.ReadToEndAsync()).Trim();
                return new DetectResult(true, version, claudePath, null);
            }
            var stderr = (await proc.StandardError.ReadToEndAsync()).Trim();
            return new DetectResult(false, null, claudePath, stderr.Length > 0 ? stderr : $"`claude --version` exited with {proc.ExitCode}");
        }
        catch (OperationCanceledException)
        {
            return new DetectResult(false, null, claudePath, "`claude --version` timed out after 3s");
        }
        catch (Exception ex)
        {
            return new DetectResult(false, null, claudePath, $"Failed to spawn `claude`: {ex.Message}");
        }
    }

    public async Task Spawn(
        string streamId,
        string model,
        IReadOnlyList<ClaudeMessage> messages,
        Func<string, Task> onLine,
        Func<int?, string, Task> onDone)
    {
        var claudePath = FindClaude() ?? throw new InvalidOperationException("`claude` not found on PATH");

        var systemPreamble = string.Join("\n\n", messages.Where(m => m.Role == "system").Select(m => m.Content));
        var conversation = messages.Where(m => m.Role is "user" or "assistant").ToList();
        if (conversation.Count == 0) throw new InvalidOperationException("No user/assistant messages");

        var psi = new ProcessStartInfo(claudePath)
        {
            UseShellExecute = false,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        psi.ArgumentList.Add("-p");
        psi.ArgumentList.Add("--output-format"); psi.ArgumentList.Add("stream-json");
        psi.ArgumentList.Add("--input-format"); psi.ArgumentList.Add("stream-json");
        psi.ArgumentList.Add("--verbose");
        psi.ArgumentList.Add("--model"); psi.ArgumentList.Add(model);

        var proc = Process.Start(psi)!;
        _processes[streamId] = proc;

        try
        {
            bool firstUser = true;
            foreach (var msg in conversation)
            {
                var content = msg.Content;
                if (firstUser && msg.Role == "user" && systemPreamble.Length > 0)
                {
                    content = $"{systemPreamble}\n\n{content}";
                    firstUser = false;
                }

                var evt = JsonSerializer.Serialize(new
                {
                    type = msg.Role,
                    message = new { role = msg.Role, content = new[] { new { type = "text", text = content } } }
                });
                await proc.StandardInput.WriteLineAsync(evt);
            }
            await proc.StandardInput.FlushAsync();
            proc.StandardInput.Close();

            var stderrTask = proc.StandardError.ReadToEndAsync();
            string? line;
            while ((line = await proc.StandardOutput.ReadLineAsync()) != null)
                await onLine(line);

            await proc.WaitForExitAsync();
            var stderr = (await stderrTask).Trim();
            await onDone(proc.ExitCode, stderr);
        }
        finally
        {
            _processes.TryRemove(streamId, out _);
            try { proc.Kill(entireProcessTree: false); } catch { /* already exited */ }
            proc.Dispose();
        }
    }

    public void Kill(string streamId)
    {
        if (_processes.TryRemove(streamId, out var proc))
            try { proc.Kill(); } catch { /* already exited */ }
    }

    private static string? FindClaude()
    {
        var candidates = OperatingSystem.IsWindows()
            ? new[] { "claude.cmd", "claude.exe", "claude" }
            : new[] { "claude" };

        return candidates.Select(FindOnPath).FirstOrDefault(p => p is not null);
    }

    private static string? FindOnPath(string name)
    {
        var pathEnv = Environment.GetEnvironmentVariable("PATH") ?? "";
        return pathEnv.Split(Path.PathSeparator)
            .Select(dir => Path.Combine(dir, name))
            .FirstOrDefault(File.Exists);
    }
}
