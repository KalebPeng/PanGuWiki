using Microsoft.AspNetCore.DataProtection;

namespace LlmWiki.Api.Infrastructure;

public class LlmConfigService(IDataProtectionProvider provider)
{
    private readonly IDataProtector _protector =
        provider.CreateProtector("LlmWiki.ApiKeys");

    public string Encrypt(string plainKey) => _protector.Protect(plainKey);
    public string Decrypt(string encryptedKey) => _protector.Unprotect(encryptedKey);

    public string EncryptIfNotEmpty(string plainKey) =>
        string.IsNullOrEmpty(plainKey) ? plainKey : Encrypt(plainKey);

    public string DecryptIfNotEmpty(string encryptedKey) =>
        string.IsNullOrEmpty(encryptedKey) ? encryptedKey : Decrypt(encryptedKey);
}
