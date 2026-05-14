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
  setAuth: (user: AuthUser, token: string) => void
  clearAuth: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      isAuthenticated: false,
      setAuth: (user, token) => {
        localStorage.setItem('llmwiki:auth:token', token)
        set({ user, accessToken: token, isAuthenticated: true })
      },
      clearAuth: () => {
        localStorage.removeItem('llmwiki:auth:token')
        set({ user: null, accessToken: null, isAuthenticated: false })
      },
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
            // token 不存在则重置认证状态
            state.isAuthenticated = false
          }
        }
      },
    }
  )
)
