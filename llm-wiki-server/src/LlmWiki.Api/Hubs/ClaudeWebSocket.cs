using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using LlmWiki.Api.Services;

namespace LlmWiki.Api.Hubs;

public class ClaudeWebSocket(ClaudeCliService claudeCliService)
{
    public async Task Handle(WebSocket ws)
    {
        var buffer = new byte[1024 * 64];
        while (ws.State == WebSocketState.Open)
        {
            string json;
            try { json = await ReceiveTextMessage(ws, buffer); }
            catch { break; }
            if (json.Length == 0) break;

            JsonElement msg;
            try { msg = JsonDocument.Parse(json).RootElement; }
            catch { continue; }

            var type = msg.TryGetProperty("type", out var t) ? t.GetString() : null;
            var streamId = msg.TryGetProperty("streamId", out var s) ? s.GetString() ?? "" : "";

            if (type == "spawn")
            {
                var model = msg.TryGetProperty("model", out var m) ? m.GetString() ?? "claude-opus-4-6" : "claude-opus-4-6";
                var messages = msg.TryGetProperty("messages", out var msgs)
                    ? msgs.Deserialize<List<ClaudeMessage>>() ?? []
                    : new List<ClaudeMessage>();

                _ = Task.Run(async () =>
                {
                    try
                    {
                        await claudeCliService.Spawn(
                            streamId, model, messages,
                            onLine: async line => await SendJson(ws, new { type = "line", streamId, payload = line }),
                            onDone: async (code, stderr) => await SendJson(ws, new { type = "done", streamId, code, stderr })
                        );
                    }
                    catch (Exception ex)
                    {
                        await SendJson(ws, new { type = "error", streamId, message = ex.Message });
                    }
                });
            }
            else if (type == "kill")
            {
                claudeCliService.Kill(streamId);
            }
        }
    }

    private static async Task SendJson(WebSocket ws, object payload)
    {
        if (ws.State != WebSocketState.Open) return;
        var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(payload));
        try
        {
            await ws.SendAsync(bytes, WebSocketMessageType.Text, endOfMessage: true, CancellationToken.None);
        }
        catch { /* connection closed */ }
    }

    private static async Task<string> ReceiveTextMessage(WebSocket ws, byte[] buffer)
    {
        using var ms = new MemoryStream();
        WebSocketReceiveResult result;
        do
        {
            result = await ws.ReceiveAsync(buffer, CancellationToken.None);
            if (result.MessageType == WebSocketMessageType.Close)
            {
                await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "bye", CancellationToken.None);
                return "";
            }
            ms.Write(buffer, 0, result.Count);
        } while (!result.EndOfMessage);

        return Encoding.UTF8.GetString(ms.ToArray());
    }
}
