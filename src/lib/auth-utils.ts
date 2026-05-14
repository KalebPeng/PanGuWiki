/**
 * 从 localStorage 中的 JWT 解码 payload，判断是否为超级管理员。
 * 注意：这仅用于 UI 显示控制，实际权限由后端 RequireSuperAdminAttribute 保证。
 */
export function isSuperAdminFromToken(): boolean {
  const token = localStorage.getItem('llmwiki:auth:token')
  if (!token) return false
  try {
    // JWT 使用 base64url 编码，需替换 - 和 _ 并补 padding
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - b64.length % 4) % 4)
    const payload = JSON.parse(atob(padded))
    return payload['is_super_admin'] === 'true'
  } catch {
    return false
  }
}
