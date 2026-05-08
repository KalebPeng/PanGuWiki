namespace LlmWiki.Api.Services;

public record ProxyConfig(
    bool Enabled,
    string? HttpProxy,
    string? HttpsProxy,
    string? NoProxy);

public class ProxyService
{
    public string ApplyProxy(ProxyConfig config)
    {
        if (!config.Enabled)
        {
            Environment.SetEnvironmentVariable("HTTP_PROXY", null);
            Environment.SetEnvironmentVariable("HTTPS_PROXY", null);
            Environment.SetEnvironmentVariable("NO_PROXY", null);
            return "proxy disabled";
        }

        if (!string.IsNullOrEmpty(config.HttpProxy))
            Environment.SetEnvironmentVariable("HTTP_PROXY", config.HttpProxy);
        if (!string.IsNullOrEmpty(config.HttpsProxy))
            Environment.SetEnvironmentVariable("HTTPS_PROXY", config.HttpsProxy);
        if (!string.IsNullOrEmpty(config.NoProxy))
            Environment.SetEnvironmentVariable("NO_PROXY", config.NoProxy);

        return $"proxy set: HTTP={config.HttpProxy} HTTPS={config.HttpsProxy}";
    }
}
