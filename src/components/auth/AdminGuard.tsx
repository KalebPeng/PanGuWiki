import { Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuthStore } from '../../stores/auth-store'
import { isSuperAdminFromToken } from '../../lib/auth-utils'

export function AdminGuard({ children }: { children: ReactNode }) {
  const hasHydrated = useAuthStore(s => s.hasHydrated)

  if (!hasHydrated) return null

  if (!isSuperAdminFromToken()) {
    return <Navigate to="/login" replace />
  }
  return <>{children}</>
}
