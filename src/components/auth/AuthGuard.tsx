import { Navigate } from 'react-router-dom'
import { useAuthStore } from '../../stores/auth-store'
import { useOrgStore } from '../../stores/org-store'
import type { ReactNode } from 'react'

interface AuthGuardProps {
  children: ReactNode
  requireDept?: boolean
}

export function AuthGuard({ children, requireDept = false }: AuthGuardProps) {
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const hasHydrated = useAuthStore(s => s.hasHydrated)
  const activeDeptId = useOrgStore(s => s.activeDeptId)

  // 等待 store 从 localStorage 水化完成，避免重开窗口时短暂跳转到登录页
  if (!hasHydrated) {
    return null
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  if (requireDept && !activeDeptId) {
    return <Navigate to="/select-dept" replace />
  }

  return <>{children}</>
}
