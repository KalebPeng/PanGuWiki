import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface AuthUser {
  id: string
  email: string
  displayName: string
}

interface AuthState {
  user: AuthUser | null
  accessToken: string | null
  isAuthenticated: boolean
  hasHydrated: boolean          // 水化完成标志，避免重开窗口时短暂跳转登录页
  setAuth: (user: AuthUser, token: string) => void
  clearAuth: () => void
  setHasHydrated: (v: boolean) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      isAuthenticated: false,
      hasHydrated: false,
      setAuth: (user, token) => {
        localStorage.setItem('llmwiki:auth:token', token)
        set({ user, accessToken: token, isAuthenticated: true })
      },
      clearAuth: () => {
        localStorage.removeItem('llmwiki:auth:token')
        localStorage.removeItem('llmwiki:auth:refresh_token')
        set({ user: null, accessToken: null, isAuthenticated: false })
      },
      setHasHydrated: (v) => set({ hasHydrated: v }),
    }),
    {
      name: 'llmwiki:auth',
      // 只持久化 user 和 isAuthenticated，token 单独存在 localStorage 供 dotnet-client 读取
      partialize: (state) => ({ user: state.user, isAuthenticated: state.isAuthenticated }),
      onRehydrateStorage: () => (state) => {
        if (state?.isAuthenticated) {
          const token = localStorage.getItem('llmwiki:auth:token')
          if (token) {
            state.accessToken = token
          } else {
            // access token 没了，但 refresh token 可能还在，先保持登录态
            // dotnet-client 会在第一次 API 请求时自动 refresh
            const refreshToken = localStorage.getItem('llmwiki:auth:refresh_token')
            if (!refreshToken) {
              state.isAuthenticated = false
            }
          }
        }
        if (state) state.hasHydrated = true
      },
    }
  )
)
