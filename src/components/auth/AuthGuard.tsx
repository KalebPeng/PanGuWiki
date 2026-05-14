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
  const activeDeptId = useOrgStore(s => s.activeDeptId)

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  if (requireDept && !activeDeptId) {
    return <Navigate to="/select-dept" replace />
  }

  return <>{children}</>
}
