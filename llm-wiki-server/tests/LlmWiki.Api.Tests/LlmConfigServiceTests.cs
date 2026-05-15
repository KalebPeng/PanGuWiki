using LlmWiki.Api.Infrastructure;
using Microsoft.AspNetCore.DataProtection;

namespace LlmWiki.Api.Tests;

public class LlmConfigServiceTests
{
    private static LlmConfigService CreateService()
    {
        var provider = new EphemeralDataProtectionProvider();
        return new LlmConfigService(provider);
    }

    [Fact]
    public void Encrypt_ThenDecrypt_ReturnsOriginal()
    {
        var svc = CreateService();
        var plain = "sk-test-12345";
        var encrypted = svc.Encrypt(plain);
        Assert.NotEqual(plain, encrypted);
        Assert.Equal(plain, svc.Decrypt(encrypted));
    }

    [Fact]
    public void EncryptIfNotEmpty_EmptyKey_ReturnsEmpty()
    {
        var svc = CreateService();
        Assert.Equal("", svc.EncryptIfNotEmpty(""));
    }

    [Fact]
    public void DecryptIfNotEmpty_EmptyKey_ReturnsEmpty()
    {
        var svc = CreateService();
        Assert.Equal("", svc.DecryptIfNotEmpty(""));
    }
}
