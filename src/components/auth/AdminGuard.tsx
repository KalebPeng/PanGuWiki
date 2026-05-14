import { Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { isSuperAdminFromToken } from '../../lib/auth-utils'

export function AdminGuard({ children }: { children: ReactNode }) {
  if (!isSuperAdminFromToken()) {
    return <Navigate to="/login" replace />
  }
  return <>{children}</>
}
